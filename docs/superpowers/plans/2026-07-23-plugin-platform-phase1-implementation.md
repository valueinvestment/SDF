# Plugin Platform Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `apps/backend-sim`'s hardcoded `SensorSimulator`-only data path with two plugin contracts — `Collector` (per-machine data acquisition, own polling cadence) and `PipelineStage` (per-machine, ordered processing) — so `SensorSimulator` becomes just one `Collector` implementation among future real ones, while the existing 10Hz broadcast loop only ever reads from a cache and never awaits collector I/O directly.

**Architecture:** `CollectorRegistry` runs each registered `Collector` on its own background `asyncio.Task` at its own `poll_interval_sec`, writing into a shared cache keyed by machine id (last-known-good value retained on failure, forced to `"offline"` after 3x the collector's poll interval with no success). `PipelineRegistry` holds a flat, globally-ordered list of `PipelineStage`s and runs each machine's cached state through them every broadcast tick, with per-stage try/except isolation (a throwing stage logs and is skipped; the pre-stage state passes to the next stage unchanged). The rewritten `simulation_loop` in `main.py` reads the cache, runs the pipeline, detects `"fault"` status *transitions* generically (regardless of whether the simulator's random fault-injection timer or a real `PipelineStage` caused them) to fire `anomaly_detected`, then broadcasts — mirroring the existing `detail_loop` (2Hz) vs `simulation_loop` (10Hz) decoupling already in this codebase.

**Tech Stack:** Python 3.11+, FastAPI, Pydantic v2, pytest + pytest-asyncio (strict mode — every async test needs `@pytest.mark.asyncio`), uv (dev commands) — but **use `.venv\Scripts\python.exe -m pytest` directly if `uv run` fails** (confirmed broken in this environment with `error: uv trampoline failed to canonicalize script path`; the venv itself is healthy).

**Spec:** `docs/superpowers/specs/2026-07-22-plugin-platform-roadmap-v2.md`, Phase 1 section.

**Design deviations from the spec's illustrative sketch (verified necessary against the real code):**
1. `SimulatorCollector.machine_ids` is a **live property** reading `self._simulator.machine_ids`, not a fixed list captured at construction. The existing `ws_gateway._handle_sync_entities` → `simulator.sync_entities()` path lets the frontend dynamically add/remove machines at runtime; a fixed list would silently stop collecting newly-synced machines forever. This is a real regression the spec's static sketch (`machine_ids=["M1","M2","M4","M5"]`) didn't account for.
2. `installed.py` exposes `build_installed_collectors(simulator)` (a factory function), not a bare module-level list depending on an already-constructed `simulator` — the spec's sketch would require `installed.py` to import a `simulator` instance from `main.py`, which is circular (`main.py` needs to import `installed.py` to register collectors).
3. Robots are read via a new stateless `SensorSimulator.robots_snapshot()` instead of being bundled into the `Collector.collect()` return value. `Collector.collect()` only returns `dict[str, MachineState]` per the contract; robot broadcasting must stay decoupled from the collector cache (per the non-goal "no robot data collection" — robots remain simulator-driven directly), and `tick()`'s robot-building logic doesn't touch RNG state, so factoring it out is safe and avoids double-computing.

---

### Task 1: Widen `MachineStatus` to include `"offline"`

**Files:**
- Modify: `apps/backend-sim/simulator/models.py:4`
- Modify: `packages/types/src/index.ts:19`

- [ ] **Step 1: Widen the backend Literal**

Find in `apps/backend-sim/simulator/models.py`:
```python
MachineStatus = Literal["normal", "degraded", "fault"]
```

Replace with:
```python
MachineStatus = Literal["normal", "degraded", "fault", "offline"]
```

- [ ] **Step 2: Widen the frontend type**

Find in `packages/types/src/index.ts`:
```typescript
export type MachineStatus = "normal" | "degraded" | "fault"
```

Replace with:
```typescript
export type MachineStatus = "normal" | "degraded" | "fault" | "offline"
```

- [ ] **Step 3: Verify nothing breaks**

Run (from repo root): `pnpm typecheck`
Expected: PASS. `apps/host-twin/lib/threeHelpers.ts`'s `STATUS_COLORS` is `Record<string, number>` (not `Record<MachineStatus, ...>`) and already falls back to `0x6b7280` (gray) for unmapped status keys via `STATUS_COLORS[status] ?? 0x6b7280` — no frontend code change needed for `"offline"` to render safely. Confirmed via `grep -rn "Record<MachineStatus\|MachineStatus," apps/host-twin` returning no matches before this plan.

Run (from `apps/backend-sim`): `.\.venv\Scripts\python.exe -m pytest -q`
Expected: PASS (21 tests — unchanged, this is a pure type widening).

- [ ] **Step 4: Commit**

```bash
git add apps/backend-sim/simulator/models.py packages/types/src/index.ts
git commit -m "feat(types): add offline to MachineStatus for Phase 1 collector cache staleness"
```

---

### Task 2: `Collector` / `PipelineStage` contracts

**Files:**
- Create: `apps/backend-sim/plugins/__init__.py`
- Create: `apps/backend-sim/plugins/contracts.py`
- Test: `apps/backend-sim/tests/test_contracts.py`

- [ ] **Step 1: Write the failing test**

Create `apps/backend-sim/tests/test_contracts.py`:

```python
from plugins.contracts import Collector, PipelineStage
from simulator.models import MachineState


class _FakeCollector:
    id = "fake"
    machine_ids = ["M1"]
    poll_interval_sec = 1.0

    async def collect(self):
        return {}


class _FakePipelineStage:
    id = "fake-stage"

    def process(self, machine_id, state):
        return state


def test_conforming_collector_satisfies_protocol():
    assert isinstance(_FakeCollector(), Collector)


def test_conforming_pipeline_stage_satisfies_protocol():
    assert isinstance(_FakePipelineStage(), PipelineStage)


def test_non_conforming_object_does_not_satisfy_collector_protocol():
    class NotACollector:
        pass

    assert not isinstance(NotACollector(), Collector)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_contracts.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'plugins'`

- [ ] **Step 3: Write minimal implementation**

Create `apps/backend-sim/plugins/__init__.py` (empty file).

Create `apps/backend-sim/plugins/contracts.py`:

```python
from typing import Protocol, runtime_checkable
from simulator.models import MachineState


@runtime_checkable
class Collector(Protocol):
    id: str
    machine_ids: list[str]
    poll_interval_sec: float

    async def collect(self) -> dict[str, MachineState]:
        """Fetch the latest state for every machine this collector owns. Raise on failure."""
        ...


@runtime_checkable
class PipelineStage(Protocol):
    id: str

    def process(self, machine_id: str, state: MachineState) -> MachineState:
        """Called once per machine per tick. Pass state through unchanged if not relevant."""
        ...
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_contracts.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/backend-sim/plugins/__init__.py apps/backend-sim/plugins/contracts.py apps/backend-sim/tests/test_contracts.py
git commit -m "feat(backend-sim): add Collector and PipelineStage plugin contracts"
```

---

### Task 3: `CollectorRegistry` — registration with duplicate-id and machine-ownership rejection

**Files:**
- Create: `apps/backend-sim/plugins/collector_registry.py`
- Test: `apps/backend-sim/tests/test_collector_registry.py`

- [ ] **Step 1: Write the failing test**

Create `apps/backend-sim/tests/test_collector_registry.py`:

```python
import pytest
from plugins.collector_registry import CollectorRegistry
from simulator.models import MachineState


def make_state(status="normal"):
    return MachineState(vibration=50.0, temperature=60.0, current=10.0, status=status)


class FakeCollector:
    def __init__(self, id, machine_ids, poll_interval_sec=0.05, states=None, fail=False):
        self.id = id
        self.machine_ids = machine_ids
        self.poll_interval_sec = poll_interval_sec
        self._states = states or {mid: make_state() for mid in machine_ids}
        self.fail = fail
        self.call_count = 0

    async def collect(self):
        self.call_count += 1
        if self.fail:
            raise RuntimeError("collector failed")
        return dict(self._states)


def test_register_rejects_duplicate_collector_id():
    registry = CollectorRegistry()
    registry.register(FakeCollector("c1", ["M1"]))
    with pytest.raises(ValueError, match="collector id already registered"):
        registry.register(FakeCollector("c1", ["M2"]))


def test_register_rejects_overlapping_machine_ownership():
    registry = CollectorRegistry()
    registry.register(FakeCollector("c1", ["M1"]))
    with pytest.raises(ValueError, match="already owned by collector"):
        registry.register(FakeCollector("c2", ["M1"]))


def test_get_cached_state_returns_none_before_any_poll():
    registry = CollectorRegistry()
    registry.register(FakeCollector("c1", ["M1"]))
    assert registry.get_cached_state("M1") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_collector_registry.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'plugins.collector_registry'`

- [ ] **Step 3: Write minimal implementation**

Create `apps/backend-sim/plugins/collector_registry.py`:

```python
from dataclasses import dataclass
from simulator.models import MachineState
from plugins.contracts import Collector


@dataclass
class _CacheEntry:
    state: MachineState
    last_success: float
    poll_interval_sec: float


class CollectorRegistry:
    def __init__(self):
        self._collectors: dict[str, Collector] = {}
        self._owner: dict[str, str] = {}
        self._cache: dict[str, _CacheEntry] = {}

    def register(self, collector: Collector) -> None:
        if collector.id in self._collectors:
            raise ValueError(f"[CollectorRegistry] collector id already registered: {collector.id}")
        for mid in collector.machine_ids:
            if mid in self._owner:
                raise ValueError(
                    f"[CollectorRegistry] machine '{mid}' already owned by collector '{self._owner[mid]}'"
                )
        self._collectors[collector.id] = collector
        for mid in collector.machine_ids:
            self._owner[mid] = collector.id

    def get_cached_state(self, machine_id: str) -> MachineState | None:
        entry = self._cache.get(machine_id)
        if entry is None:
            return None
        return entry.state
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_collector_registry.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/backend-sim/plugins/collector_registry.py apps/backend-sim/tests/test_collector_registry.py
git commit -m "feat(backend-sim): add CollectorRegistry with registration and ownership checks"
```

---

### Task 4: `CollectorRegistry` — `poll_once()` populates cache, keeps last-known-good on failure

**Files:**
- Modify: `apps/backend-sim/plugins/collector_registry.py`
- Modify: `apps/backend-sim/tests/test_collector_registry.py`

- [ ] **Step 1: Write the failing tests**

Append to `apps/backend-sim/tests/test_collector_registry.py`:

```python
import time


@pytest.mark.asyncio
async def test_poll_once_populates_cache():
    registry = CollectorRegistry()
    registry.register(FakeCollector("c1", ["M1", "M2"]))
    await registry.poll_once("c1")
    assert registry.get_cached_state("M1").status == "normal"
    assert registry.get_cached_state("M2").status == "normal"


@pytest.mark.asyncio
async def test_poll_once_keeps_last_known_good_state_on_failure():
    registry = CollectorRegistry()
    collector = FakeCollector("c1", ["M1"])
    registry.register(collector)
    await registry.poll_once("c1")
    collector.fail = True
    await registry.poll_once("c1")
    assert registry.get_cached_state("M1").status == "normal"  # last good value retained
    assert collector.call_count == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_collector_registry.py -v`
Expected: FAIL — `CollectorRegistry has no attribute 'poll_once'`

- [ ] **Step 3: Write minimal implementation**

In `apps/backend-sim/plugins/collector_registry.py`, add `import time` at the top and add this method to `CollectorRegistry` (after `register`):

```python
    async def poll_once(self, collector_id: str) -> None:
        collector = self._collectors[collector_id]
        try:
            states = await collector.collect()
        except Exception as e:
            print(f"[CollectorRegistry] collector '{collector.id}' collect() failed: {e}", flush=True)
            return
        now = time.time()
        for mid, state in states.items():
            self._cache[mid] = _CacheEntry(
                state=state, last_success=now, poll_interval_sec=collector.poll_interval_sec
            )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_collector_registry.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/backend-sim/plugins/collector_registry.py apps/backend-sim/tests/test_collector_registry.py
git commit -m "feat(backend-sim): CollectorRegistry.poll_once populates cache, retains last-known-good on failure"
```

---

### Task 5: `CollectorRegistry` — force `"offline"` after stale threshold

**Files:**
- Modify: `apps/backend-sim/plugins/collector_registry.py`
- Modify: `apps/backend-sim/tests/test_collector_registry.py`

- [ ] **Step 1: Write the failing tests**

Append to `apps/backend-sim/tests/test_collector_registry.py`:

```python
@pytest.mark.asyncio
async def test_cached_state_forced_offline_after_stale_threshold():
    registry = CollectorRegistry()
    registry.register(FakeCollector("c1", ["M1"], poll_interval_sec=0.01))
    await registry.poll_once("c1")
    registry._cache["M1"].last_success = time.time() - 1.0  # far beyond 3 * 0.01s
    result = registry.get_cached_state("M1")
    assert result.status == "offline"


@pytest.mark.asyncio
async def test_cached_state_not_offline_within_threshold():
    registry = CollectorRegistry()
    registry.register(FakeCollector("c1", ["M1"], poll_interval_sec=1.0))
    await registry.poll_once("c1")
    result = registry.get_cached_state("M1")
    assert result.status == "normal"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_collector_registry.py -v`
Expected: FAIL — `test_cached_state_forced_offline_after_stale_threshold` fails because `get_cached_state` still returns `status == "normal"`.

- [ ] **Step 3: Write minimal implementation**

In `apps/backend-sim/plugins/collector_registry.py`, replace `get_cached_state`:

```python
    def get_cached_state(self, machine_id: str) -> MachineState | None:
        entry = self._cache.get(machine_id)
        if entry is None:
            return None
        if time.time() - entry.last_success > 3 * entry.poll_interval_sec:
            return entry.state.model_copy(update={"status": "offline"})
        return entry.state
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_collector_registry.py -v`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/backend-sim/plugins/collector_registry.py apps/backend-sim/tests/test_collector_registry.py
git commit -m "feat(backend-sim): CollectorRegistry forces offline status after 3x poll interval of no success"
```

---

### Task 6: `CollectorRegistry` — `prime_all()`, `start_all()`/`stop_all()` background task lifecycle

**Files:**
- Modify: `apps/backend-sim/plugins/collector_registry.py`
- Modify: `apps/backend-sim/tests/test_collector_registry.py`

- [ ] **Step 1: Write the failing tests**

Append to `apps/backend-sim/tests/test_collector_registry.py`:

```python
import asyncio


@pytest.mark.asyncio
async def test_prime_all_polls_every_registered_collector():
    registry = CollectorRegistry()
    registry.register(FakeCollector("c1", ["M1"]))
    registry.register(FakeCollector("c2", ["M2"]))
    await registry.prime_all()
    assert registry.get_cached_state("M1") is not None
    assert registry.get_cached_state("M2") is not None


@pytest.mark.asyncio
async def test_start_all_runs_background_polls():
    registry = CollectorRegistry()
    collector = FakeCollector("c1", ["M1"], poll_interval_sec=0.02)
    registry.register(collector)
    registry.start_all()
    await asyncio.sleep(0.07)
    registry.stop_all()
    assert collector.call_count >= 2


@pytest.mark.asyncio
async def test_start_all_is_idempotent_for_already_started_collector():
    registry = CollectorRegistry()
    collector = FakeCollector("c1", ["M1"], poll_interval_sec=0.02)
    registry.register(collector)
    registry.start_all()
    registry.start_all()  # must not spawn a second task for the same collector
    await asyncio.sleep(0.05)
    registry.stop_all()
    call_count_after_stop = collector.call_count
    await asyncio.sleep(0.05)
    assert collector.call_count == call_count_after_stop  # stop_all actually cancelled the task
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_collector_registry.py -v`
Expected: FAIL — `CollectorRegistry has no attribute 'prime_all'`

- [ ] **Step 3: Write minimal implementation**

In `apps/backend-sim/plugins/collector_registry.py`, add `import asyncio` at the top, add a `self._tasks: dict[str, asyncio.Task] = {}` line in `__init__`, and add these methods (after `poll_once`):

```python
    async def prime_all(self) -> None:
        for cid in list(self._collectors):
            await self.poll_once(cid)

    def start_all(self) -> None:
        for cid, collector in self._collectors.items():
            if cid not in self._tasks:
                self._tasks[cid] = asyncio.create_task(self._run_loop(collector))

    async def _run_loop(self, collector: Collector) -> None:
        while True:
            await asyncio.sleep(collector.poll_interval_sec)
            await self.poll_once(collector.id)

    def stop_all(self) -> None:
        for task in self._tasks.values():
            task.cancel()
        self._tasks.clear()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_collector_registry.py -v`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/backend-sim/plugins/collector_registry.py apps/backend-sim/tests/test_collector_registry.py
git commit -m "feat(backend-sim): CollectorRegistry background polling lifecycle (prime_all/start_all/stop_all)"
```

---

### Task 7: `PipelineRegistry` — ordered stages with per-stage error isolation

**Files:**
- Create: `apps/backend-sim/plugins/pipeline_registry.py`
- Test: `apps/backend-sim/tests/test_pipeline_registry.py`

- [ ] **Step 1: Write the failing test**

Create `apps/backend-sim/tests/test_pipeline_registry.py`:

```python
import pytest
from plugins.pipeline_registry import PipelineRegistry
from simulator.models import MachineState


def make_state(status="normal", temperature=60.0):
    return MachineState(vibration=50.0, temperature=temperature, current=10.0, status=status)


class DoublingStage:
    id = "doubler"

    def process(self, machine_id, state):
        return state.model_copy(update={"vibration": state.vibration * 2})


class ThresholdFaultStage:
    id = "threshold-fault"

    def process(self, machine_id, state):
        if state.temperature > 100:
            return state.model_copy(update={"status": "fault"})
        return state


class BoomStage:
    id = "boom"

    def process(self, machine_id, state):
        raise RuntimeError("stage exploded")


def test_register_rejects_duplicate_stage_id():
    registry = PipelineRegistry()
    registry.register(DoublingStage())
    with pytest.raises(ValueError, match="pipeline stage id already registered"):
        registry.register(DoublingStage())


def test_run_applies_stages_in_registration_order():
    registry = PipelineRegistry()
    registry.register(DoublingStage())
    registry.register(ThresholdFaultStage())
    result = registry.run("M1", make_state(temperature=120.0))
    assert result.vibration == 100.0
    assert result.status == "fault"


def test_run_isolates_a_throwing_stage_and_passes_pre_stage_state_through():
    registry = PipelineRegistry()
    registry.register(BoomStage())
    registry.register(DoublingStage())
    result = registry.run("M1", make_state())
    assert result.vibration == 100.0  # doubler still ran despite boom stage failing


def test_run_failure_on_one_machine_does_not_affect_another():
    class FailsOnlyForM1:
        id = "fails-m1"

        def process(self, machine_id, state):
            if machine_id == "M1":
                raise RuntimeError("boom")
            return state.model_copy(update={"vibration": state.vibration + 1})

    registry = PipelineRegistry()
    registry.register(FailsOnlyForM1())
    result_m1 = registry.run("M1", make_state())
    result_m2 = registry.run("M2", make_state())
    assert result_m1.vibration == 50.0
    assert result_m2.vibration == 51.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_pipeline_registry.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'plugins.pipeline_registry'`

- [ ] **Step 3: Write minimal implementation**

Create `apps/backend-sim/plugins/pipeline_registry.py`:

```python
from plugins.contracts import PipelineStage
from simulator.models import MachineState


class PipelineRegistry:
    def __init__(self):
        self._stages: list[PipelineStage] = []
        self._ids: set[str] = set()

    def register(self, stage: PipelineStage) -> None:
        if stage.id in self._ids:
            raise ValueError(f"[PipelineRegistry] pipeline stage id already registered: {stage.id}")
        self._ids.add(stage.id)
        self._stages.append(stage)

    def run(self, machine_id: str, state: MachineState) -> MachineState:
        for stage in self._stages:
            try:
                state = stage.process(machine_id, state)
            except Exception as e:
                print(
                    f"[PipelineRegistry] stage '{stage.id}' failed for machine '{machine_id}': {e}",
                    flush=True,
                )
        return state
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_pipeline_registry.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/backend-sim/plugins/pipeline_registry.py apps/backend-sim/tests/test_pipeline_registry.py
git commit -m "feat(backend-sim): add PipelineRegistry with per-stage error isolation"
```

---

### Task 8: `SensorSimulator.robots_snapshot()` — stateless robot read, factored out of `tick()`

**Files:**
- Modify: `apps/backend-sim/simulator/sensor_simulator.py`
- Modify: `apps/backend-sim/tests/test_simulator.py`

- [ ] **Step 1: Write the failing test**

Append to `apps/backend-sim/tests/test_simulator.py`:

```python
def test_robots_snapshot_matches_tick_and_is_stateless():
    sim = SensorSimulator(seed=42)
    first = sim.robots_snapshot()
    second = sim.robots_snapshot()
    assert first == second  # repeated calls don't drift — no RNG involved

    tick_snapshot = sim.tick()
    assert tick_snapshot.robots == sim.robots_snapshot()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_simulator.py -v`
Expected: FAIL — `AttributeError: 'SensorSimulator' object has no attribute 'robots_snapshot'`

- [ ] **Step 3: Write minimal implementation**

In `apps/backend-sim/simulator/sensor_simulator.py`, replace the `tick()` method:

Find:
```python
    def tick(self) -> SensorSnapshot:
        machines = {}
        for mid in self._machine_positions:
            if mid in self._faulted:
                status = "fault"
                vibration = self._rng.uniform(120, 200)
                temperature = self._rng.uniform(110, 150)
                current = self._rng.uniform(40, 60)
            else:
                status = "normal"
                vibration = self._rng.uniform(20, 80)
                temperature = self._rng.uniform(40, 90)
                current = self._rng.uniform(5, 30)
            machines[mid] = MachineState(
                vibration=round(vibration, 2),
                temperature=round(temperature, 2),
                current=round(current, 2),
                status=status,
            )

        robots = {}
        for rid in self._robot_positions:
            pos = self._robot_positions[rid]
            robots[rid] = RobotState(
                x=round(pos[0], 2),
                y=round(pos[1], 2),
                heading=round(self._robot_headings.get(rid, 0.0), 1),
                status=self._robot_statuses.get(rid, "idle"),
            )

        return SensorSnapshot(
            ts=int(time.time() * 1000),
            machines=machines,
            robots=robots,
        )
```

Replace with:
```python
    def robots_snapshot(self) -> dict[str, RobotState]:
        robots = {}
        for rid in self._robot_positions:
            pos = self._robot_positions[rid]
            robots[rid] = RobotState(
                x=round(pos[0], 2),
                y=round(pos[1], 2),
                heading=round(self._robot_headings.get(rid, 0.0), 1),
                status=self._robot_statuses.get(rid, "idle"),
            )
        return robots

    def tick(self) -> SensorSnapshot:
        machines = {}
        for mid in self._machine_positions:
            if mid in self._faulted:
                status = "fault"
                vibration = self._rng.uniform(120, 200)
                temperature = self._rng.uniform(110, 150)
                current = self._rng.uniform(40, 60)
            else:
                status = "normal"
                vibration = self._rng.uniform(20, 80)
                temperature = self._rng.uniform(40, 90)
                current = self._rng.uniform(5, 30)
            machines[mid] = MachineState(
                vibration=round(vibration, 2),
                temperature=round(temperature, 2),
                current=round(current, 2),
                status=status,
            )

        return SensorSnapshot(
            ts=int(time.time() * 1000),
            machines=machines,
            robots=self.robots_snapshot(),
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_simulator.py -v`
Expected: PASS (6 tests — 5 existing + 1 new)

- [ ] **Step 5: Commit**

```bash
git add apps/backend-sim/simulator/sensor_simulator.py apps/backend-sim/tests/test_simulator.py
git commit -m "refactor(backend-sim): extract SensorSimulator.robots_snapshot() from tick()"
```

---

### Task 9: `SimulatorCollector` — wraps `SensorSimulator` as a `Collector`

**Files:**
- Create: `apps/backend-sim/plugins/simulator_collector.py`
- Test: `apps/backend-sim/tests/test_simulator_collector.py`

- [ ] **Step 1: Write the failing test**

Create `apps/backend-sim/tests/test_simulator_collector.py`:

```python
import pytest
from plugins.contracts import Collector
from plugins.simulator_collector import SimulatorCollector
from simulator.sensor_simulator import SensorSimulator


def test_simulator_collector_satisfies_collector_protocol():
    sim = SensorSimulator(seed=42)
    collector = SimulatorCollector(simulator=sim)
    assert isinstance(collector, Collector)


@pytest.mark.asyncio
async def test_collect_returns_all_simulator_machines():
    sim = SensorSimulator(seed=42)
    collector = SimulatorCollector(simulator=sim)
    states = await collector.collect()
    assert set(states.keys()) == set(sim.machine_ids)


@pytest.mark.asyncio
async def test_collect_reflects_injected_fault():
    sim = SensorSimulator(seed=42)
    sim.inject_fault("M1")
    collector = SimulatorCollector(simulator=sim)
    states = await collector.collect()
    assert states["M1"].status == "fault"


def test_machine_ids_reflects_live_simulator_state_after_dynamic_sync():
    """Regression guard: ws_gateway._handle_sync_entities can add/remove machines
    at runtime via simulator.sync_entities(). machine_ids must stay live so newly
    synced machines are picked up on the next poll instead of never being collected."""
    sim = SensorSimulator(seed=42)
    collector = SimulatorCollector(simulator=sim)
    assert set(collector.machine_ids) == set(sim.machine_ids)

    sim.sync_entities(machines={"M9": (1.0, 1.0)}, robots={})
    assert "M9" in collector.machine_ids
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_simulator_collector.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'plugins.simulator_collector'`

- [ ] **Step 3: Write minimal implementation**

Create `apps/backend-sim/plugins/simulator_collector.py`:

```python
from simulator.models import MachineState
from simulator.sensor_simulator import SensorSimulator


class SimulatorCollector:
    """Wraps SensorSimulator as a Collector. machine_ids is a live property (not
    captured at construction) so machines added/removed at runtime via
    simulator.sync_entities() are picked up automatically on the next poll."""

    def __init__(self, simulator: SensorSimulator, id: str = "simulator", poll_interval_sec: float = 0.1):
        self.id = id
        self.poll_interval_sec = poll_interval_sec
        self._simulator = simulator

    @property
    def machine_ids(self) -> list[str]:
        return self._simulator.machine_ids

    async def collect(self) -> dict[str, MachineState]:
        snapshot = self._simulator.tick()
        return dict(snapshot.machines)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_simulator_collector.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/backend-sim/plugins/simulator_collector.py apps/backend-sim/tests/test_simulator_collector.py
git commit -m "feat(backend-sim): add SimulatorCollector wrapping SensorSimulator"
```

---

### Task 10: `plugins/installed.py` — static registration entry point

**Files:**
- Create: `apps/backend-sim/plugins/installed.py`
- Test: `apps/backend-sim/tests/test_installed.py`

- [ ] **Step 1: Write the failing test**

Create `apps/backend-sim/tests/test_installed.py`:

```python
from simulator.sensor_simulator import SensorSimulator
from plugins.installed import build_installed_collectors, installed_pipeline_stages


def test_build_installed_collectors_owns_all_simulator_machines():
    sim = SensorSimulator(seed=42)
    collectors = build_installed_collectors(sim)
    owned = {mid for c in collectors for mid in c.machine_ids}
    assert owned == set(sim.machine_ids)


def test_installed_pipeline_stages_starts_empty():
    assert installed_pipeline_stages == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_installed.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'plugins.installed'`

- [ ] **Step 3: Write minimal implementation**

Create `apps/backend-sim/plugins/installed.py`:

```python
"""Static plugin registration — the only file a plugin author needs to edit to
add a Collector or PipelineStage. Phase 4.5 will add an importlib-based dynamic
loader that calls CollectorRegistry.register()/PipelineRegistry.register() at
the same entry points used here, without changing this file's shape."""
from simulator.sensor_simulator import SensorSimulator
from plugins.contracts import Collector, PipelineStage
from plugins.simulator_collector import SimulatorCollector


def build_installed_collectors(simulator: SensorSimulator) -> list[Collector]:
    return [
        SimulatorCollector(simulator=simulator),
    ]


installed_pipeline_stages: list[PipelineStage] = []
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_installed.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/backend-sim/plugins/installed.py apps/backend-sim/tests/test_installed.py
git commit -m "feat(backend-sim): add plugins/installed.py static registration entry point"
```

---

### Task 11: Integration test — slow collector, failing stage, offline transition, generalized `anomaly_detected`

Write this test against the registries directly (no `main.py` wiring needed yet — that's Task 12) to validate the pieces compose correctly before touching the live app.

**Files:**
- Test: `apps/backend-sim/tests/test_plugin_integration.py`

- [ ] **Step 1: Write the test**

Create `apps/backend-sim/tests/test_plugin_integration.py`:

```python
import asyncio
import pytest
from plugins.collector_registry import CollectorRegistry
from plugins.pipeline_registry import PipelineRegistry
from simulator.models import MachineState


def make_state(status="normal", temperature=60.0):
    return MachineState(vibration=50.0, temperature=temperature, current=10.0, status=status)


class SlowCollector:
    """Simulates a real device with non-trivial I/O latency."""

    id = "slow"
    machine_ids = ["M1", "M2"]
    poll_interval_sec = 0.03

    def __init__(self):
        self.call_count = 0

    async def collect(self):
        self.call_count += 1
        await asyncio.sleep(0.01)
        return {
            "M1": make_state(temperature=60.0),
            "M2": make_state(temperature=60.0),
        }


class FailingStage:
    """Always throws — must not break the pipeline for any machine."""

    id = "failing-stage"

    def process(self, machine_id, state):
        raise RuntimeError("stage always fails")


class ThresholdFaultStage:
    id = "threshold-fault"

    def process(self, machine_id, state):
        if machine_id == "M1" and state.temperature > 50:
            return state.model_copy(update={"status": "fault"})
        return state


@pytest.mark.asyncio
async def test_slow_collector_and_failing_stage_do_not_block_or_crash_the_pipeline():
    collector_registry = CollectorRegistry()
    pipeline_registry = PipelineRegistry()
    collector = SlowCollector()
    collector_registry.register(collector)
    pipeline_registry.register(FailingStage())

    await collector_registry.prime_all()

    for mid in ["M1", "M2"]:
        cached = collector_registry.get_cached_state(mid)
        assert cached is not None
        result = pipeline_registry.run(mid, cached)
        assert result.temperature == 60.0  # FailingStage never applied, pre-stage state passed through


@pytest.mark.asyncio
async def test_cache_forces_offline_when_collector_stops_succeeding():
    collector_registry = CollectorRegistry()
    collector = SlowCollector()
    collector_registry.register(collector)
    await collector_registry.prime_all()
    collector_registry._cache["M1"].last_success -= 1.0  # well beyond 3 * 0.03s
    assert collector_registry.get_cached_state("M1").status == "offline"
    assert collector_registry.get_cached_state("M2").status != "offline"


def test_anomaly_transition_detection_fires_on_any_source_of_fault():
    """Mirrors the transition-detection logic main.py's broadcast loop uses:
    fire once when a machine's post-pipeline status transitions TO "fault",
    regardless of whether a PipelineStage or the raw collected state caused it."""
    pipeline_registry = PipelineRegistry()
    pipeline_registry.register(ThresholdFaultStage())

    last_status: dict[str, str] = {}
    fired: list[str] = []

    def tick(machine_id: str, raw_state: MachineState) -> None:
        processed = pipeline_registry.run(machine_id, raw_state)
        previous = last_status.get(machine_id)
        if processed.status == "fault" and previous != "fault":
            fired.append(machine_id)
        last_status[machine_id] = processed.status

    tick("M1", make_state(temperature=60.0))  # threshold stage flips to fault
    tick("M1", make_state(temperature=60.0))  # still fault — must not re-fire
    tick("M1", make_state(temperature=10.0))  # recovers to normal
    tick("M1", make_state(temperature=60.0))  # faults again — must re-fire

    assert fired == ["M1", "M1"]
```

- [ ] **Step 2: Run test to verify it passes**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_plugin_integration.py -v`
Expected: PASS (3 tests). No implementation changes needed — this validates the composition of Tasks 3–7.

- [ ] **Step 3: Commit**

```bash
git add apps/backend-sim/tests/test_plugin_integration.py
git commit -m "test(backend-sim): add integration tests for collector/pipeline composition and anomaly transition detection"
```

---

### Task 12: Wire `CollectorRegistry`/`PipelineRegistry` into `main.py`

**Files:**
- Modify: `apps/backend-sim/main.py`

- [ ] **Step 1: Replace the imports and module-level setup**

Find:
```python
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import asyncio
import random
import time
import os
from dotenv import load_dotenv
from gateway.event_bus import EventBus
from gateway.ws_gateway import WebSocketGateway
from simulator.sensor_simulator import SensorSimulator
from simulator.detail_simulator import DetailSimulator
from agents.orchestrator import AgentOrchestrator

load_dotenv()

# 워커가 (재)임포트될 때마다 갱신 — /health 의 started_at 이 안 바뀌면 stale 프로세스라는 신호
STARTED_AT = time.strftime("%Y-%m-%d %H:%M:%S")

bus = EventBus()
simulator = SensorSimulator(seed=int(time.time()))
detail_sim = DetailSimulator(seed=42)
gateway = WebSocketGateway(simulator, detail_sim)
orchestrator = AgentOrchestrator(bus, gateway, simulator, detail_sim)
```

Replace with:
```python
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import asyncio
import random
import time
import os
from dotenv import load_dotenv
from gateway.event_bus import EventBus
from gateway.ws_gateway import WebSocketGateway
from simulator.sensor_simulator import SensorSimulator
from simulator.detail_simulator import DetailSimulator
from simulator.models import SensorSnapshot
from agents.orchestrator import AgentOrchestrator
from plugins.collector_registry import CollectorRegistry
from plugins.pipeline_registry import PipelineRegistry
from plugins.installed import build_installed_collectors, installed_pipeline_stages

load_dotenv()

# 워커가 (재)임포트될 때마다 갱신 — /health 의 started_at 이 안 바뀌면 stale 프로세스라는 신호
STARTED_AT = time.strftime("%Y-%m-%d %H:%M:%S")

bus = EventBus()
simulator = SensorSimulator(seed=int(time.time()))
detail_sim = DetailSimulator(seed=42)
gateway = WebSocketGateway(simulator, detail_sim)
orchestrator = AgentOrchestrator(bus, gateway, simulator, detail_sim)

collector_registry = CollectorRegistry()
pipeline_registry = PipelineRegistry()
for _collector in build_installed_collectors(simulator):
    collector_registry.register(_collector)
for _stage in installed_pipeline_stages:
    pipeline_registry.register(_stage)

_last_status: dict[str, str] = {}
```

- [ ] **Step 2: Rewrite `simulation_loop` to read from the cache instead of calling `simulator.tick()` directly**

Find:
```python
async def simulation_loop():
    next_fault_at = time.time() + random.uniform(60, 120)
    faulted_machine = None
    while True:
        try:
            now = time.time()
            if faulted_machine is None and now >= next_fault_at:
                machine_ids = simulator.machine_ids
                if not machine_ids:
                    next_fault_at = now + random.uniform(60, 120)
                    await asyncio.sleep(0.1)
                    continue
                faulted_machine = random.choice(machine_ids)
                simulator.inject_fault(faulted_machine)
                await bus.publish({"type": "anomaly_detected", "machineId": faulted_machine})
            if faulted_machine and now >= next_fault_at + 30:
                simulator.clear_fault(faulted_machine)
                detail_sim.clear_faults(faulted_machine)
                faulted_machine = None
                next_fault_at = now + random.uniform(60, 120)
            snapshot = simulator.tick()
            msg = {"type": "sensor_update", "payload": snapshot.model_dump()}
            await gateway.broadcast(msg)          # direct — no bus middleman
            await bus.publish(msg)                # still notify orchestrator
        except Exception as e:
            print(f"[simulation_loop] error: {e}", flush=True)
        await asyncio.sleep(0.1)
```

Replace with:
```python
async def simulation_loop():
    """10Hz broadcast tick. Never awaits collector I/O directly — CollectorRegistry's
    own background tasks (started in lifespan()) own that. This loop only reads the
    cache, runs the pipeline, and detects anomaly transitions generically (regardless
    of whether the fault-injection timer below or a real PipelineStage caused them)."""
    next_fault_at = time.time() + random.uniform(60, 120)
    faulted_machine = None
    while True:
        try:
            now = time.time()
            if faulted_machine is None and now >= next_fault_at:
                machine_ids = simulator.machine_ids
                if not machine_ids:
                    next_fault_at = now + random.uniform(60, 120)
                    await asyncio.sleep(0.1)
                    continue
                faulted_machine = random.choice(machine_ids)
                simulator.inject_fault(faulted_machine)
            if faulted_machine and now >= next_fault_at + 30:
                simulator.clear_fault(faulted_machine)
                detail_sim.clear_faults(faulted_machine)
                faulted_machine = None
                next_fault_at = now + random.uniform(60, 120)

            machines = {}
            for mid in simulator.machine_ids:
                cached = collector_registry.get_cached_state(mid)
                if cached is None:
                    continue  # not yet collected (only possible briefly around a dynamic sync_entities add)
                processed = pipeline_registry.run(mid, cached)
                machines[mid] = processed
                previous = _last_status.get(mid)
                if processed.status == "fault" and previous != "fault":
                    await bus.publish({"type": "anomaly_detected", "machineId": mid})
                _last_status[mid] = processed.status

            snapshot = SensorSnapshot(
                ts=int(time.time() * 1000),
                machines=machines,
                robots=simulator.robots_snapshot(),
            )
            msg = {"type": "sensor_update", "payload": snapshot.model_dump()}
            await gateway.broadcast(msg)          # direct — no bus middleman
            await bus.publish(msg)                # still notify orchestrator
        except Exception as e:
            print(f"[simulation_loop] error: {e}", flush=True)
        await asyncio.sleep(0.1)
```

- [ ] **Step 3: Prime and start the collector registry in `lifespan`, stop it on shutdown**

Find:
```python
@asynccontextmanager
async def lifespan(app):
    # 시작 배너: 재시작이 실제로 새 코드로 떴는지 한눈에 확인 (pid/gateway id/시각)
    print(
        f"[startup] backend online - pid={os.getpid()} gateway_id={id(gateway)} started_at={STARTED_AT}",
        flush=True,
    )
    tasks = [
        asyncio.create_task(simulation_loop()),
        asyncio.create_task(broadcast_loop()),
        asyncio.create_task(orchestrator.start()),
        asyncio.create_task(detail_loop()),
    ]
    yield
    for t in tasks:
        t.cancel()
```

Replace with:
```python
@asynccontextmanager
async def lifespan(app):
    # 시작 배너: 재시작이 실제로 새 코드로 떴는지 한눈에 확인 (pid/gateway id/시각)
    print(
        f"[startup] backend online - pid={os.getpid()} gateway_id={id(gateway)} started_at={STARTED_AT}",
        flush=True,
    )
    await collector_registry.prime_all()  # warm the cache before the first broadcast tick
    collector_registry.start_all()
    tasks = [
        asyncio.create_task(simulation_loop()),
        asyncio.create_task(broadcast_loop()),
        asyncio.create_task(orchestrator.start()),
        asyncio.create_task(detail_loop()),
    ]
    yield
    collector_registry.stop_all()
    for t in tasks:
        t.cancel()
```

- [ ] **Step 4: Verify the app still imports and boots cleanly**

Run: `.\.venv\Scripts\python.exe -c "import main"`
Expected: no import errors.

Run (from `apps/backend-sim`): `.\.venv\Scripts\python.exe -m pytest -q`
Expected: PASS — all existing + new tests green.

- [ ] **Step 5: Manual smoke check**

Run: `pnpm --filter @sdf/backend-sim dev` (or `.\.venv\Scripts\python.exe -m uvicorn main:app --reload --host 0.0.0.0 --port 8000` if the uv-based script fails, matching the `uv run` trampoline issue noted at the top of this plan)

Open `http://localhost:8000/health` in a browser. Expected: `{"status": "ok", ...}` with a fresh `started_at`.

Run `pnpm --filter @sdf/host-twin dev` in a second terminal, open `http://localhost:3000`. Expected: the 3D canvas shows machines updating exactly as before (sensor values, occasional fault → recovery cycle, alert popups, agent panel activity) — no visual change, since this task only replaces the internal data path.

Stop both dev servers.

- [ ] **Step 6: Commit**

```bash
git add apps/backend-sim/main.py
git commit -m "feat(backend-sim): wire CollectorRegistry/PipelineRegistry into the broadcast loop"
```

---

### Task 13: Full-repo verification

**Files:** none (verification only)

- [ ] **Step 1: Backend test suite**

Run (from `apps/backend-sim`): `.\.venv\Scripts\python.exe -m pytest -q`
Expected: PASS — 21 original + all new tests from Tasks 1–11 (offline widening adds 0, contracts +3, collector_registry +10, pipeline_registry +4, robots_snapshot +1, simulator_collector +4, installed +2, plugin_integration +3 → 21 + 27 = 48 tests total).

- [ ] **Step 2: Frontend typecheck and tests**

Run (from repo root): `pnpm typecheck`
Expected: PASS for every package.

Run (from repo root): `pnpm test`
Expected: PASS — unaffected by this backend-only change, confirms no regression.

Run (from repo root): `pnpm build`
Expected: PASS.

- [ ] **Step 3: If any step fails, fix before considering Phase 1 done**

Do not proceed to opening a PR until all commands pass cleanly.

---

## Self-Review Notes

- **Spec coverage:** Architecture diagram (collector cache → pipeline → broadcast, decoupled from 10Hz loop) → Tasks 3–6, 12. Component contracts → Task 2. Registry + error isolation → Tasks 3–7. Offline handling + `MachineStatus` widening → Tasks 1, 5. Anomaly detection generalization → Tasks 11 (isolated logic test), 12 (real wiring). Static registration (`installed.py`) → Task 10. Test plan (registry dup-id, stage error isolation, offline transition, slow-collector + failing-stage integration) → Tasks 3, 5, 7, 11. Non-goals (no dynamic loading, no robot collection, no collector-config UI, no `AgentOrchestrator` changes) — verified not touched by any task; `AgentOrchestrator` and `agents/*.py` are untouched, `robots_snapshot()` keeps robots on the existing simulator-direct path.
- **Type consistency verified:** `MachineState` field names (`vibration`, `temperature`, `current`, `status`) match across `models.py`, all new plugin files, and every test. `Collector` attributes (`id`, `machine_ids`, `poll_interval_sec`, `collect()`) match exactly between `contracts.py`, `collector_registry.py`, `simulator_collector.py`, and `installed.py`. `PipelineStage` attributes (`id`, `process(machine_id, state)`) match across `contracts.py`, `pipeline_registry.py`, and all test fakes.
- **No placeholders:** every step has complete, exact code; the "design deviations" section documents and justifies the three points where this plan departs from the spec's illustrative sketch (verified against the real `ws_gateway.py`/`main.py` code, not assumed).
