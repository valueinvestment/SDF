# Phase 4.5 — 백엔드 플러그인 동적 로딩 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a directory-polling `importlib` loader that lets a `.py` file dropped into `apps/backend-sim/plugins/uploaded/` be picked up within 5 seconds and registered as a `Collector`/`PipelineStage`, with zero server restart.

**Architecture:** A new `scan_and_load()` function scans a directory for unseen `.py` files, loads each via `importlib.util`, validates any `collectors`/`pipeline_stages` module-level lists against the existing `@runtime_checkable` protocols, and registers them through the existing `CollectorRegistry.register()`/`PipelineRegistry.register()` — reusing their existing `record_error()` for failures, so nothing new is needed for errors to reach the frontend Inspector (Phase 6's `plugin_error` WS pipeline already covers it). A thin `dynamic_loader_loop()` wrapper calls it every 5 seconds from `main.py`'s `lifespan()`.

**Tech Stack:** Python 3.14, `importlib.util`, `asyncio`, `pytest` + `pytest-asyncio` (`tmp_path` fixture for real-file tests).

**Design spec:** `docs/superpowers/specs/2026-07-28-plugin-platform-phase4-5-backend-dynamic-loading-design.md`

---

### Task 1: `dynamic_loader.py` — core loading logic

**Files:**
- Create: `apps/backend-sim/plugins/dynamic_loader.py`
- Test: `apps/backend-sim/tests/test_dynamic_loader.py`

- [ ] **Step 1: Write the failing tests**

Create `apps/backend-sim/tests/test_dynamic_loader.py`:

```python
import sys

import pytest
from plugins.collector_registry import CollectorRegistry
from plugins.pipeline_registry import PipelineRegistry
from plugins.dynamic_loader import scan_and_load
from simulator.models import MachineState


class FakeCollector:
    def __init__(self, id, machine_ids):
        self.id = id
        self.machine_ids = machine_ids
        self.poll_interval_sec = 10.0

    async def collect(self):
        return {mid: MachineState(vibration=1.0, temperature=1.0, current=1.0, status="normal") for mid in self.machine_ids}


class FakePipelineStage:
    def __init__(self, id):
        self.id = id

    def process(self, machine_id, state):
        return state.model_copy(update={"status": "fault"})


COLLECTOR_FILE = '''
from simulator.models import MachineState


class FakeCollector:
    id = "dyn-c1"
    machine_ids = ["DYN-M1"]
    poll_interval_sec = 10.0

    async def collect(self):
        return {"DYN-M1": MachineState(vibration=1.0, temperature=1.0, current=1.0, status="normal")}


collectors = [FakeCollector()]
'''

PIPELINE_FILE = '''
class FakeStage:
    id = "dyn-stage1"

    def process(self, machine_id, state):
        return state.model_copy(update={"status": "fault"})


pipeline_stages = [FakeStage()]
'''

BROKEN_FILE = "this is not valid python :::"

BAD_SHAPE_COLLECTOR_FILE = '''
collectors = ["not a collector"]
'''

BAD_SHAPE_STAGE_FILE = '''
pipeline_stages = ["not a stage"]
'''


@pytest.mark.asyncio
async def test_scan_and_load_noop_when_directory_missing(tmp_path):
    missing_dir = tmp_path / "does-not-exist"
    collector_registry = CollectorRegistry()
    pipeline_registry = PipelineRegistry()
    loaded: set[str] = set()

    await scan_and_load(missing_dir, collector_registry, pipeline_registry, loaded)  # must not raise


@pytest.mark.asyncio
async def test_scan_and_load_registers_and_primes_collector(tmp_path):
    collector_registry = CollectorRegistry()
    pipeline_registry = PipelineRegistry()
    loaded: set[str] = set()
    (tmp_path / "plugin1.py").write_text(COLLECTOR_FILE)

    await scan_and_load(tmp_path, collector_registry, pipeline_registry, loaded)

    cached = collector_registry.get_cached_state("DYN-M1")
    assert cached is not None
    assert cached.status == "normal"


@pytest.mark.asyncio
async def test_scan_and_load_registers_pipeline_stage(tmp_path):
    collector_registry = CollectorRegistry()
    pipeline_registry = PipelineRegistry()
    loaded: set[str] = set()
    (tmp_path / "stage1.py").write_text(PIPELINE_FILE)

    await scan_and_load(tmp_path, collector_registry, pipeline_registry, loaded)

    result = pipeline_registry.run(
        "M1", MachineState(vibration=1.0, temperature=1.0, current=1.0, status="normal")
    )
    assert result.status == "fault"


@pytest.mark.asyncio
async def test_scan_and_load_does_not_reprocess_already_loaded_files(tmp_path):
    collector_registry = CollectorRegistry()
    pipeline_registry = PipelineRegistry()
    loaded: set[str] = set()
    (tmp_path / "plugin1.py").write_text(COLLECTOR_FILE)

    await scan_and_load(tmp_path, collector_registry, pipeline_registry, loaded)
    await scan_and_load(tmp_path, collector_registry, pipeline_registry, loaded)

    assert collector_registry.get_all_errors() == {}  # no duplicate-id error from re-registering


@pytest.mark.asyncio
async def test_scan_and_load_skips_broken_file_without_raising(tmp_path):
    collector_registry = CollectorRegistry()
    pipeline_registry = PipelineRegistry()
    loaded: set[str] = set()
    (tmp_path / "broken.py").write_text(BROKEN_FILE)

    await scan_and_load(tmp_path, collector_registry, pipeline_registry, loaded)  # must not raise

    assert "broken.py" in loaded  # marked as attempted, won't be retried


@pytest.mark.asyncio
async def test_scan_and_load_skips_collector_entry_that_fails_protocol_check(tmp_path):
    collector_registry = CollectorRegistry()
    pipeline_registry = PipelineRegistry()
    loaded: set[str] = set()
    (tmp_path / "bad_shape.py").write_text(BAD_SHAPE_COLLECTOR_FILE)

    await scan_and_load(tmp_path, collector_registry, pipeline_registry, loaded)  # must not raise

    assert collector_registry.get_all_errors() == {}


@pytest.mark.asyncio
async def test_scan_and_load_skips_stage_entry_that_fails_protocol_check(tmp_path):
    collector_registry = CollectorRegistry()
    pipeline_registry = PipelineRegistry()
    loaded: set[str] = set()
    (tmp_path / "bad_shape.py").write_text(BAD_SHAPE_STAGE_FILE)

    await scan_and_load(tmp_path, collector_registry, pipeline_registry, loaded)  # must not raise

    assert pipeline_registry.get_all_errors() == {}


@pytest.mark.asyncio
async def test_scan_and_load_records_error_on_duplicate_collector_id(tmp_path):
    collector_registry = CollectorRegistry()
    pipeline_registry = PipelineRegistry()
    collector_registry.register(FakeCollector("dyn-c1", ["EXISTING-M1"]))  # same id as COLLECTOR_FILE below
    loaded: set[str] = set()
    (tmp_path / "plugin1.py").write_text(COLLECTOR_FILE)

    await scan_and_load(tmp_path, collector_registry, pipeline_registry, loaded)

    errors = collector_registry.get_all_errors()
    assert "dyn-c1" in errors
    assert "already registered" in errors["dyn-c1"][0].message


@pytest.mark.asyncio
async def test_scan_and_load_records_error_on_duplicate_pipeline_stage_id(tmp_path):
    collector_registry = CollectorRegistry()
    pipeline_registry = PipelineRegistry()
    pipeline_registry.register(FakePipelineStage("dyn-stage1"))  # same id as PIPELINE_FILE below
    loaded: set[str] = set()
    (tmp_path / "stage1.py").write_text(PIPELINE_FILE)

    await scan_and_load(tmp_path, collector_registry, pipeline_registry, loaded)

    errors = pipeline_registry.get_all_errors()
    assert "dyn-stage1" in errors
    assert "already registered" in errors["dyn-stage1"][0].message


@pytest.mark.asyncio
async def test_loaded_module_is_registered_in_sys_modules(tmp_path):
    collector_registry = CollectorRegistry()
    pipeline_registry = PipelineRegistry()
    loaded: set[str] = set()
    (tmp_path / "plugin1.py").write_text(COLLECTOR_FILE)

    await scan_and_load(tmp_path, collector_registry, pipeline_registry, loaded)

    assert "uploaded_plugin_plugin1" in sys.modules
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/backend-sim && .venv/Scripts/python.exe -m pytest tests/test_dynamic_loader.py -v`
Expected: FAIL (collection error) — `plugins.dynamic_loader` doesn't exist yet.

- [ ] **Step 3: Implement `dynamic_loader.py`**

Create `apps/backend-sim/plugins/dynamic_loader.py`:

```python
import asyncio
import importlib.util
import sys
from pathlib import Path

from plugins.contracts import Collector, PipelineStage
from plugins.collector_registry import CollectorRegistry
from plugins.pipeline_registry import PipelineRegistry


def _load_module_from_path(path: Path):
    spec = importlib.util.spec_from_file_location(f"uploaded_plugin_{path.stem}", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


async def scan_and_load(
    directory: Path,
    collector_registry: CollectorRegistry,
    pipeline_registry: PipelineRegistry,
    loaded: set[str],
) -> None:
    """Scans `directory` for .py files not yet in `loaded` and registers any
    `collectors`/`pipeline_stages` module-level lists they declare. Every attempted
    filename is added to `loaded` regardless of outcome — editing an already-loaded
    file has no effect until the file is renamed or the server restarts (`loaded`
    resets to empty on restart, so a fresh process re-processes everything in the
    folder). Hot-reload-on-edit is a deliberate non-goal; see the design doc."""
    if not directory.exists():
        return
    for path in sorted(directory.glob("*.py")):
        if path.name in loaded:
            continue
        loaded.add(path.name)
        try:
            module = _load_module_from_path(path)
        except Exception as e:
            print(f"[dynamic_loader] failed to import {path.name}: {e}", flush=True)
            continue

        for collector in getattr(module, "collectors", []):
            if not isinstance(collector, Collector):
                print(f"[dynamic_loader] {path.name}: collectors entry is not a valid Collector", flush=True)
                continue
            try:
                collector_registry.register(collector)
                await collector_registry.poll_once(collector.id)
            except Exception as e:
                collector_registry.record_error(collector.id, str(e))

        for stage in getattr(module, "pipeline_stages", []):
            if not isinstance(stage, PipelineStage):
                print(f"[dynamic_loader] {path.name}: pipeline_stages entry is not a valid PipelineStage", flush=True)
                continue
            try:
                pipeline_registry.register(stage)
            except Exception as e:
                pipeline_registry.record_error(stage.id, str(e))

    collector_registry.start_all()  # idempotent — only starts tasks for newly-registered collectors


async def dynamic_loader_loop(
    directory: Path,
    collector_registry: CollectorRegistry,
    pipeline_registry: PipelineRegistry,
    interval_sec: float = 5.0,
) -> None:
    """Background task: calls scan_and_load() on a timer for the process lifetime."""
    directory.mkdir(parents=True, exist_ok=True)
    loaded: set[str] = set()
    while True:
        await scan_and_load(directory, collector_registry, pipeline_registry, loaded)
        await asyncio.sleep(interval_sec)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/backend-sim && .venv/Scripts/python.exe -m pytest tests/test_dynamic_loader.py -v`
Expected: PASS — all 10 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/backend-sim/plugins/dynamic_loader.py apps/backend-sim/tests/test_dynamic_loader.py
git commit -m "feat(backend-sim): add importlib-based dynamic plugin loader"
```

---

### Task 2: Wire the loader into `main.py` and set up the drop directory

**Files:**
- Modify: `apps/backend-sim/main.py`
- Create: `apps/backend-sim/plugins/uploaded/.gitkeep`
- Modify: `.gitignore`

- [ ] **Step 1: Add the background task to `main.py`**

In `apps/backend-sim/main.py`, add this import near the other `plugins.*` imports (after `from plugins.error_detection import detect_new_plugin_errors`):

```python
from pathlib import Path
from plugins.dynamic_loader import dynamic_loader_loop
```

Add this module-level constant right after the existing `pipeline_registry = PipelineRegistry()` line and the `for _stage in installed_pipeline_stages:` loop that follows it:

```python
UPLOADED_PLUGINS_DIR = Path(__file__).parent / "plugins" / "uploaded"
```

In the `lifespan()` function, find the `tasks = [...]` list:

```python
    tasks = [
        asyncio.create_task(simulation_loop()),
        asyncio.create_task(broadcast_loop()),
        asyncio.create_task(orchestrator.start()),
        asyncio.create_task(detail_loop()),
    ]
```

Add the new task:

```python
    tasks = [
        asyncio.create_task(simulation_loop()),
        asyncio.create_task(broadcast_loop()),
        asyncio.create_task(orchestrator.start()),
        asyncio.create_task(detail_loop()),
        asyncio.create_task(dynamic_loader_loop(UPLOADED_PLUGINS_DIR, collector_registry, pipeline_registry)),
    ]
```

- [ ] **Step 2: Create the drop directory placeholder**

Create `apps/backend-sim/plugins/uploaded/.gitkeep` (empty file) — `dynamic_loader_loop()` also creates this directory at runtime via `directory.mkdir(parents=True, exist_ok=True)`, but committing a `.gitkeep` means the folder exists in a fresh checkout too, so a developer doesn't have to start the server once before they can find where to drop a file.

- [ ] **Step 3: Gitignore uploaded plugin files**

In the root `.gitignore`, add a new line after the existing `.pytest_cache/` line:

```
apps/backend-sim/plugins/uploaded/*.py
```

- [ ] **Step 4: Run the full backend test suite to confirm no regressions**

Run: `cd apps/backend-sim && .venv/Scripts/python.exe -m pytest -q`
Expected: PASS — 71 tests (61 pre-existing + 10 new from Task 1).

- [ ] **Step 5: Commit**

```bash
git add apps/backend-sim/main.py apps/backend-sim/plugins/uploaded/.gitkeep .gitignore
git commit -m "feat(backend-sim): start the dynamic plugin loader from lifespan()"
```

---

### Task 3: Committed example plugin

**Files:**
- Create: `examples/plugins/example_pipeline_stage.py`
- Test: `apps/backend-sim/tests/test_example_pipeline_stage.py`

This file is not imported by the app — it exists so a developer can copy it into `apps/backend-sim/plugins/uploaded/` and watch it work within 5 seconds, mirroring `examples/plugins/machine-counter-plugin.js` from Phase 4 and `examples/sdfrec/sample-session.sdfrec` from Phase 7. It's a `PipelineStage`, not a `Collector` — per the design doc, a dynamically-loaded `Collector` introducing a brand-new machine id would register and poll successfully but never appear in any dashboard broadcast (`main.py`'s `simulation_loop` only iterates `simulator.machine_ids`, which comes from frontend-placed entities, not from `CollectorRegistry` — a pre-existing architectural limitation explicitly out of scope for this phase). A `PipelineStage` only transforms machines that are already being broadcast, so it has no such gap.

- [ ] **Step 1: Create the example plugin file**

Create `examples/plugins/example_pipeline_stage.py`:

```python
"""SDF Digital Twin — 예시 백엔드 플러그인 (런타임 동적 로딩용)

이 파일을 apps/backend-sim/plugins/uploaded/ 에 복사해두면, 서버가 5초 이내에
자동으로 감지해서 로드·등록합니다 (재시작 불필요) — 대시보드를 보고 있으면
곧 M1~M5 중 하나가 fault 상태로 바뀌는 걸 확인할 수 있습니다.

pipeline_stages: list[PipelineStage] 를 모듈 최상위에 정의하면 dynamic_loader가
이 리스트를 읽어 PipelineRegistry.register()를 대신 호출합니다 — 이 파일이 직접
registry를 다루지 않습니다.

Collector가 아니라 PipelineStage를 예시로 고른 이유: 동적으로 로드된 Collector가
simulator.machine_ids(프론트엔드가 캔버스에 배치한 엔티티 목록)에 없는 새 머신
id를 등록하면 등록·폴링까지는 성공하지만 브로드캐스트 대상에서 제외되어 대시보드에
보이지 않습니다(기존 아키텍처의 제약). PipelineStage는 이미 브로드캐스트되고 있는
기존 머신의 상태를 매 tick마다 변형할 뿐이라 이 문제 자체가 없어, 파일을 놓자마자
바로 눈으로 확인할 수 있습니다.
"""
from simulator.models import MachineState


class ExampleVibrationThresholdStage:
    """진동이 임계값을 넘으면 상태를 fault로 전환하는 최소 예시 PipelineStage.
    임계값(60)은 정상 범위(20~80)의 중간값으로, 데모가 몇 초 안에 보이도록
    일부러 낮게 잡았다 — 실제 산업 안전 임계값이 아니다. 기존
    tests/test_plugin_integration.py의 ThresholdFaultStage와 같은 패턴이다.
    main.py의 anomaly_detected 발화 로직은 "fault로의 전이"만 감지하므로,
    이 스테이지가 상태를 바꾸면 기존 알림 파이프라인도 그대로 반응한다."""

    id = "example-vibration-threshold"

    def process(self, machine_id: str, state: MachineState) -> MachineState:
        if state.vibration > 60 and state.status == "normal":
            return state.model_copy(update={"status": "fault"})
        return state


pipeline_stages = [ExampleVibrationThresholdStage()]
```

- [ ] **Step 2: Write a regression test that loads the real committed file through the real loader**

Create `apps/backend-sim/tests/test_example_pipeline_stage.py`:

```python
from pathlib import Path

from plugins.dynamic_loader import _load_module_from_path
from simulator.models import MachineState


def test_example_pipeline_stage_flags_high_vibration_and_passes_through_normal():
    repo_root = Path(__file__).resolve().parents[3]
    example_path = repo_root / "examples" / "plugins" / "example_pipeline_stage.py"
    module = _load_module_from_path(example_path)
    stage = module.pipeline_stages[0]

    normal_state = MachineState(vibration=40.0, temperature=60.0, current=10.0, status="normal")
    assert stage.process("M1", normal_state).status == "normal"

    high_vibration_state = MachineState(vibration=70.0, temperature=60.0, current=10.0, status="normal")
    assert stage.process("M1", high_vibration_state).status == "fault"

    already_faulted_state = MachineState(vibration=70.0, temperature=60.0, current=10.0, status="fault")
    assert stage.process("M1", already_faulted_state).status == "fault"  # unchanged, not re-processed differently
```

This test deliberately reuses `dynamic_loader._load_module_from_path` (the exact function the real loader uses) rather than a package-relative import — it doubles as proof that the committed example file is actually loadable by the real dynamic loader, not just syntactically valid Python.

- [ ] **Step 3: Run the test to verify it passes**

Run: `cd apps/backend-sim && .venv/Scripts/python.exe -m pytest tests/test_example_pipeline_stage.py -v`
Expected: PASS — 1 test.

- [ ] **Step 4: Manually verify the example in a running server (best effort)**

Run: `cd apps/backend-sim && .venv/Scripts/python.exe -m uvicorn main:app --reload` (or the project's normal dev-server command)

Copy `examples/plugins/example_pipeline_stage.py` into `apps/backend-sim/plugins/uploaded/`. Watch the server log for `[dynamic_loader]` output (there should be none, since this file loads cleanly) and, if the frontend dev server is also running, confirm a machine eventually flips to `fault` in the dashboard within a few seconds. This step has no automated assertion beyond Step 2–3 above — it's the same kind of best-effort manual check used for Phase 4's frontend upload flow.

- [ ] **Step 5: Commit**

```bash
git add examples/plugins/example_pipeline_stage.py apps/backend-sim/tests/test_example_pipeline_stage.py
git commit -m "docs(examples): add example_pipeline_stage.py as a runtime-upload example"
```

---

### Task 4: Update the roadmap doc

**Files:**
- Modify: `docs/superpowers/specs/2026-07-22-plugin-platform-roadmap-v2.md`

- [ ] **Step 1: Mark Phase 4.5 complete**

Find the Phase 4.5 section (starts with `## Phase 4.5 — 백엔드 플러그인 동적 로딩`). Change the heading to add `(완료)`, and insert a new `**상태:**` line plus a `**실제 구현:**` paragraph right after the heading, before the existing `**목표:**` paragraph — do not delete the original 목표 paragraph, matching how Phase 4/6/7's completion notes were added earlier in this same file:

```markdown
## Phase 4.5 — 백엔드 플러그인 동적 로딩 (완료)

**상태:** 구현 완료. 상세 설계는 `2026-07-28-plugin-platform-phase4-5-backend-dynamic-loading-design.md`, 구현 계획은 `2026-07-28-plugin-platform-phase4-5-backend-dynamic-loading-implementation.md` 참조.

**실제 구현:** Phase 4와 마찬가지로 신뢰 기반(프로세스 격리 없음)으로 결정했으나 독립적으로 재평가한 결과다 — PipelineStage가 simulation_loop의 동기 10Hz 핫패스에 있어 서브프로세스 격리 시 매 tick IPC 비용이 크다는 게 결정적 이유였다. `apps/backend-sim/plugins/uploaded/`를 5초마다 폴링하는 `dynamic_loader_loop()`가 `CollectorRegistry.register()`/`PipelineRegistry.register()`를 그대로 재사용하고, 등록 실패는 기존 `record_error()`로 기록되어 Phase 6의 `plugin_error` WS 파이프라인을 통해 프런트엔드 Inspector에 추가 코드 없이 노출된다. 설계 검토 중 "동적 Collector가 도입하는 새 머신은 simulation_loop이 브로드캐스트하지 않아 대시보드에 보이지 않는다"는 기존 아키텍처의 제약을 발견해 비목표로 명시했고, 예시 플러그인은 이 문제가 없는 PipelineStage(`examples/plugins/example_pipeline_stage.py`)로 커밋했다.
```

(Keep the original `목표` paragraph below the new `실제 구현` paragraph — don't delete it, just contextualize it, matching how Phase 7's doc update handled the same situation.)

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-07-22-plugin-platform-roadmap-v2.md
git commit -m "docs: mark Phase 4.5 complete in roadmap"
```

---

## Final Verification

After all tasks:

Run: `cd apps/backend-sim && .venv/Scripts/python.exe -m pytest -q`
Expected: PASS — 72 tests (61 pre-existing + 10 from Task 1 + 1 from Task 3).

Run: `pnpm test` (repo root) — confirm the frontend suite is untouched and still green (this phase makes no frontend changes).
Expected: PASS, same counts as before this phase started.
