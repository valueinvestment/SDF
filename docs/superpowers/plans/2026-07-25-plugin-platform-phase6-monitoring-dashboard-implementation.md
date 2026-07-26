# Phase 6 — Plugin Monitoring Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `DashboardErrorBoundary` to report render errors, add backend Collector/PipelineStage error storage with real-time WebSocket push, and surface all of it (plus Phase 3b's existing registration/activation errors) in `PluginInspectorPanel`.

**Architecture:** Frontend render errors are reported via a new optional `onError` callback prop on `DashboardErrorBoundary` (avoiding a new `@sdf/ui` → `@sdf/plugin-runtime` dependency), recorded in `PluginRegistry` keyed by **panel id** (a separate map from Phase 3b's plugin-id-keyed registration/activation errors, since there's no way to attribute a panel back to its owning plugin — see design doc §2). Backend errors are stored in `CollectorRegistry`/`PipelineRegistry` (mirroring the frontend's `record`/`get` naming) and pushed to the frontend via a new `plugin_error` WebSocket message type, detected by a small pure function (`detect_new_plugin_errors`) called each tick from the existing 10Hz `simulation_loop` — mirroring the exact pattern already used for `anomaly_detected` transition detection.

**Tech Stack:** TypeScript, React 18, Zustand, Vitest + Testing Library (frontend); Python, FastAPI, pytest + pytest-asyncio (backend).

**Design spec:** `docs/superpowers/specs/2026-07-24-plugin-platform-phase6-monitoring-dashboard-design.md` — read this first for full rationale, including two things decided during design self-review that this plan implements as given: render errors are panel-id keyed (not plugin-id keyed, which is structurally impossible — see design §2), and backend error-history growth is deliberately left uncapped (see design §9 / roadmap backlog, not something to "fix" in this plan).

---

## File Structure

**Backend (`apps/backend-sim`):**
- `plugins/errors.py` (new) — `PluginErrorEntry` dataclass, shared by both registries.
- `plugins/collector_registry.py` (modify) — `record_error`/`get_all_errors`, called from `poll_once()`'s existing except block.
- `plugins/pipeline_registry.py` (modify) — same, called from `run()`'s existing except block.
- `plugins/error_detection.py` (new) — `detect_new_plugin_errors()`, a standalone pure function (deliberately NOT inside `main.py`, so it's importable and unit-testable without pulling in `main.py`'s module-level side effects — mirrors why `test_plugin_integration.py`'s existing transition-detection test also avoids importing `main.py`).
- `main.py` (modify) — wire `detect_new_plugin_errors()` into `simulation_loop`.

**Frontend:**
- `packages/types/src/index.ts` (modify) — `PluginErrorEvent` interface + `plugin_error` `WSMessage` variant.
- `packages/ui/src/DashboardErrorBoundary.tsx` (modify) — optional `onError` prop.
- `packages/plugin-runtime/src/registry.ts` (modify) — `PanelRenderError` type, panel-id-keyed render-error tracking, wired into `getPanelComponents()`.
- `packages/plugin-runtime/src/index.ts` (modify) — export `PanelRenderError`.
- `apps/host-twin/store/factoryStore.ts` (modify) — `backendPluginErrors` slice + `addBackendPluginError`.
- `apps/host-twin/hooks/useWebSocket.ts` (modify) — route `plugin_error` messages to the store (no dedicated test — see Task 9's note on why).
- `apps/host-twin/components/PluginInspectorPanel.tsx` (modify) — two new sections (panel render errors, backend errors).
- `apps/host-twin/app/page.tsx` (modify) — pass `backendErrors` prop.

---

### Task 1: Backend — `CollectorRegistry` error storage

**Files:**
- Create: `apps/backend-sim/plugins/errors.py`
- Modify: `apps/backend-sim/plugins/collector_registry.py`
- Test: `apps/backend-sim/tests/test_collector_registry.py`

- [ ] **Step 1: Write the failing tests**

Add these two tests to `apps/backend-sim/tests/test_collector_registry.py` (append at the end of the file):

```python
def test_record_error_and_get_all_errors():
    registry = CollectorRegistry()
    registry.record_error("c1", "boom")
    errors = registry.get_all_errors()
    assert len(errors["c1"]) == 1
    assert errors["c1"][0].message == "boom"


@pytest.mark.asyncio
async def test_poll_once_records_error_on_collect_failure():
    registry = CollectorRegistry()
    collector = FakeCollector("c1", ["M1"], fail=True)
    registry.register(collector)
    await registry.poll_once("c1")
    errors = registry.get_all_errors()
    assert len(errors["c1"]) == 1
    assert "collector failed" in errors["c1"][0].message
```

- [ ] **Step 2: Run test to verify it fails**

Run: `apps/backend-sim/.venv/Scripts/python.exe -m pytest apps/backend-sim/tests/test_collector_registry.py -v` (run from repo root; `uv run` is broken in this dev environment per prior sessions — invoke the venv's Python directly)
Expected: FAIL — `AttributeError: 'CollectorRegistry' object has no attribute 'record_error'`

- [ ] **Step 3: Write minimal implementation**

Create `apps/backend-sim/plugins/errors.py`:

```python
from dataclasses import dataclass


@dataclass
class PluginErrorEntry:
    message: str
    ts: float
```

Modify `apps/backend-sim/plugins/collector_registry.py`. Add this import near the top (with the other imports):

```python
from plugins.errors import PluginErrorEntry
```

Add `self._errors: dict[str, list[PluginErrorEntry]] = {}` to `__init__`, alongside the existing `self._collectors`/`self._owner`/`self._cache`/`self._tasks` fields.

Add these two methods anywhere in the class (e.g. after `get_cached_state`):

```python
    def record_error(self, id: str, message: str) -> None:
        self._errors.setdefault(id, []).append(PluginErrorEntry(message=message, ts=time.time()))

    def get_all_errors(self) -> dict[str, list[PluginErrorEntry]]:
        return dict(self._errors)
```

Modify `poll_once`'s except block — add the `record_error` call right after the existing `print(...)`:

```python
    async def poll_once(self, collector_id: str) -> None:
        collector = self._collectors[collector_id]
        try:
            states = await collector.collect()
        except Exception as e:
            print(f"[CollectorRegistry] collector '{collector.id}' collect() failed: {e}", flush=True)
            self.record_error(collector.id, str(e))
            return
```

- [ ] **Step 4: Run test to verify it passes**

Run: `apps/backend-sim/.venv/Scripts/python.exe -m pytest apps/backend-sim/tests/test_collector_registry.py -v`
Expected: PASS (all tests in the file, including the pre-existing ones)

- [ ] **Step 5: Commit**

```bash
git add apps/backend-sim/plugins/errors.py apps/backend-sim/plugins/collector_registry.py apps/backend-sim/tests/test_collector_registry.py
git commit -m "feat(backend-sim): add CollectorRegistry error storage"
```

---

### Task 2: Backend — `PipelineRegistry` error storage (mirrors Task 1)

**Files:**
- Modify: `apps/backend-sim/plugins/pipeline_registry.py`
- Test: `apps/backend-sim/tests/test_pipeline_registry.py`

- [ ] **Step 1: Write the failing tests**

Add these two tests to `apps/backend-sim/tests/test_pipeline_registry.py` (append at the end of the file):

```python
def test_record_error_and_get_all_errors():
    registry = PipelineRegistry()
    registry.record_error("s1", "boom")
    errors = registry.get_all_errors()
    assert len(errors["s1"]) == 1
    assert errors["s1"][0].message == "boom"


def test_run_records_error_when_stage_throws():
    registry = PipelineRegistry()
    registry.register(BoomStage())
    registry.run("M1", make_state())
    errors = registry.get_all_errors()
    assert len(errors["boom"]) == 1
    assert "stage exploded" in errors["boom"][0].message
```

- [ ] **Step 2: Run test to verify it fails**

Run: `apps/backend-sim/.venv/Scripts/python.exe -m pytest apps/backend-sim/tests/test_pipeline_registry.py -v`
Expected: FAIL — `AttributeError: 'PipelineRegistry' object has no attribute 'record_error'`

- [ ] **Step 3: Write minimal implementation**

Modify `apps/backend-sim/plugins/pipeline_registry.py`. Add these two imports alongside the file's existing two imports (`from plugins.contracts import PipelineStage` and `from simulator.models import MachineState`, both of which stay as-is):

```python
import time
from plugins.errors import PluginErrorEntry
```

Add `self._errors: dict[str, list[PluginErrorEntry]] = {}` to `__init__`, alongside the existing `self._stages`/`self._ids` fields.

Add these two methods anywhere in the class:

```python
    def record_error(self, id: str, message: str) -> None:
        self._errors.setdefault(id, []).append(PluginErrorEntry(message=message, ts=time.time()))

    def get_all_errors(self) -> dict[str, list[PluginErrorEntry]]:
        return dict(self._errors)
```

Modify `run`'s except block — add the `record_error` call right after the existing `print(...)`:

```python
    def run(self, machine_id: str, state: MachineState) -> MachineState:
        for stage in self._stages:
            try:
                state = stage.process(machine_id, state)
            except Exception as e:
                print(
                    f"[PipelineRegistry] stage '{stage.id}' failed for machine '{machine_id}': {e}",
                    flush=True,
                )
                self.record_error(stage.id, str(e))
        return state
```

- [ ] **Step 4: Run test to verify it passes**

Run: `apps/backend-sim/.venv/Scripts/python.exe -m pytest apps/backend-sim/tests/test_pipeline_registry.py -v`
Expected: PASS (all tests in the file, including the pre-existing ones)

- [ ] **Step 5: Commit**

```bash
git add apps/backend-sim/plugins/pipeline_registry.py apps/backend-sim/tests/test_pipeline_registry.py
git commit -m "feat(backend-sim): add PipelineRegistry error storage"
```

---

### Task 3: Backend — `detect_new_plugin_errors()` pure function

**Files:**
- Create: `apps/backend-sim/plugins/error_detection.py`
- Test: `apps/backend-sim/tests/test_error_detection.py`

- [ ] **Step 1: Write the failing tests**

Create `apps/backend-sim/tests/test_error_detection.py`:

```python
from plugins.error_detection import detect_new_plugin_errors
from plugins.errors import PluginErrorEntry


def test_first_call_returns_all_existing_errors_as_new():
    all_errors = {"c1": [PluginErrorEntry(message="boom", ts=1.0)]}
    last_seen: dict[str, int] = {}
    events = detect_new_plugin_errors(all_errors, "collector", last_seen)
    assert len(events) == 1
    assert events[0] == {"source": "collector", "id": "c1", "message": "boom", "ts": 1.0}
    assert last_seen == {"c1": 1}


def test_second_call_returns_only_newly_added_errors():
    all_errors = {"c1": [PluginErrorEntry(message="first", ts=1.0)]}
    last_seen: dict[str, int] = {}
    detect_new_plugin_errors(all_errors, "collector", last_seen)  # prime last_seen
    all_errors["c1"].append(PluginErrorEntry(message="second", ts=2.0))
    events = detect_new_plugin_errors(all_errors, "collector", last_seen)
    assert len(events) == 1
    assert events[0]["message"] == "second"


def test_ids_with_no_new_errors_are_ignored():
    all_errors = {"c1": [PluginErrorEntry(message="boom", ts=1.0)]}
    last_seen = {"c1": 1}
    events = detect_new_plugin_errors(all_errors, "collector", last_seen)
    assert events == []


def test_multiple_ids_tracked_independently():
    all_errors = {
        "c1": [PluginErrorEntry(message="a", ts=1.0)],
        "c2": [PluginErrorEntry(message="b", ts=2.0)],
    }
    last_seen = {"c1": 1}
    events = detect_new_plugin_errors(all_errors, "collector", last_seen)
    assert len(events) == 1
    assert events[0]["id"] == "c2"


def test_source_label_is_passed_through_unchanged():
    all_errors = {"s1": [PluginErrorEntry(message="boom", ts=1.0)]}
    events = detect_new_plugin_errors(all_errors, "pipeline_stage", {})
    assert events[0]["source"] == "pipeline_stage"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `apps/backend-sim/.venv/Scripts/python.exe -m pytest apps/backend-sim/tests/test_error_detection.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'plugins.error_detection'`

- [ ] **Step 3: Write minimal implementation**

Create `apps/backend-sim/plugins/error_detection.py`:

```python
from plugins.errors import PluginErrorEntry


def detect_new_plugin_errors(
    all_errors: dict[str, list[PluginErrorEntry]],
    source: str,
    last_seen_counts: dict[str, int],
) -> list[dict]:
    """Compares each id's current error list against how many entries were seen
    last time, and returns only the newly-appended ones as plain dicts ready for
    `gateway.broadcast({"type": "plugin_error", "payload": event})`. Mutates
    `last_seen_counts` in place so the caller can reuse the same dict every tick."""
    new_events: list[dict] = []
    for id, entries in all_errors.items():
        seen = last_seen_counts.get(id, 0)
        for entry in entries[seen:]:
            new_events.append({"source": source, "id": id, "message": entry.message, "ts": entry.ts})
        last_seen_counts[id] = len(entries)
    return new_events
```

- [ ] **Step 4: Run test to verify it passes**

Run: `apps/backend-sim/.venv/Scripts/python.exe -m pytest apps/backend-sim/tests/test_error_detection.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/backend-sim/plugins/error_detection.py apps/backend-sim/tests/test_error_detection.py
git commit -m "feat(backend-sim): add detect_new_plugin_errors pure function"
```

---

### Task 4: Backend — wire error detection into `simulation_loop`

**Files:**
- Modify: `apps/backend-sim/main.py`

- [ ] **Step 1: Add the import and tracking dicts**

In `apps/backend-sim/main.py`, add this import alongside the other `plugins.*` imports:

```python
from plugins.error_detection import detect_new_plugin_errors
```

Add two new module-level dicts alongside the existing `_last_status: dict[str, str] = {}`:

```python
_last_collector_error_counts: dict[str, int] = {}
_last_pipeline_error_counts: dict[str, int] = {}
```

- [ ] **Step 2: Push new errors each tick**

In `simulation_loop`, inside the `try` block, after the existing per-machine loop that computes `machines` and fires `anomaly_detected` (i.e. after the `for mid in simulator.machine_ids:` loop, before `snapshot = SensorSnapshot(...)`), add:

```python
            for event in detect_new_plugin_errors(
                collector_registry.get_all_errors(), "collector", _last_collector_error_counts
            ):
                await gateway.broadcast({"type": "plugin_error", "payload": event})
            for event in detect_new_plugin_errors(
                pipeline_registry.get_all_errors(), "pipeline_stage", _last_pipeline_error_counts
            ):
                await gateway.broadcast({"type": "plugin_error", "payload": event})
```

- [ ] **Step 3: Verify nothing broke**

This task has no new dedicated test — `simulation_loop` is an infinite loop and this codebase's established convention (per `test_plugin_integration.py`) is to unit-test the extracted pure logic (done in Task 3) rather than the loop itself. Instead, verify by running the full existing backend suite to confirm nothing regressed:

Run: `apps/backend-sim/.venv/Scripts/python.exe -m pytest apps/backend-sim/tests/ -v`
Expected: PASS (all tests, same count as before this task plus Task 1/2/3's additions — no failures)

Also sanity-check the file imports and parses correctly:

Run: `apps/backend-sim/.venv/Scripts/python.exe -c "import main"` (run from `apps/backend-sim/` directory)
Expected: no import errors (this exercises the module-level setup code — collector/pipeline registration, etc. — without starting the server)

- [ ] **Step 4: Commit**

```bash
git add apps/backend-sim/main.py
git commit -m "feat(backend-sim): push plugin_error WS messages from simulation_loop"
```

---

### Task 5: Frontend — `PluginErrorEvent` type + `plugin_error` WSMessage variant

**Files:**
- Modify: `packages/types/src/index.ts`

- [ ] **Step 1: Add the type and union variant**

In `packages/types/src/index.ts`, add this new interface right before the `WSMessage` union type definition:

```ts
export interface PluginErrorEvent {
  source: "collector" | "pipeline_stage"
  id: string
  message: string
  ts: number
}
```

Add a new line to the `WSMessage` union (which currently ends with `| { type: "component_fault"; payload: ComponentFaultMap }`):

```ts
export type WSMessage =
  | { type: "sensor_update";    payload: SensorSnapshot }
  | { type: "robot_dispatch";   payload: DispatchCommand }
  | { type: "agent_event";      payload: AgentEvent }
  | { type: "alert";            payload: Alert }
  | { type: "machine_detail";   payload: MachineDetail }
  | { type: "robot_path";       payload: RobotPathDetail }
  | { type: "component_fault";  payload: ComponentFaultMap }
  | { type: "plugin_error";     payload: PluginErrorEvent }
```

There is no test file for this package's type definitions (`packages/types` has no `test` script — it's pure type declarations, verified only via typecheck).

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @sdf/types typecheck`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/index.ts
git commit -m "feat(types): add PluginErrorEvent and plugin_error WSMessage variant"
```

---

### Task 6: Frontend — `DashboardErrorBoundary` `onError` prop

**Files:**
- Modify: `packages/ui/src/DashboardErrorBoundary.tsx`
- Test: `apps/host-twin/__tests__/DashboardErrorBoundary.test.tsx` (the component lives in `@sdf/ui` but is only tested from `apps/host-twin` — `packages/ui` has no test setup of its own; this is the existing convention, confirmed by there being no `test` script in `packages/ui/package.json`)

- [ ] **Step 1: Write the failing test**

Add this test to `apps/host-twin/__tests__/DashboardErrorBoundary.test.tsx`, inside the existing `describe("DashboardErrorBoundary (@sdf/ui)", ...)` block (after the existing tests):

```tsx
  it("calls onError with the caught error", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const onError = vi.fn()
    render(
      <DashboardErrorBoundary label="룰 엔진" onError={onError}>
        <Boom shouldThrow={true} />
      </DashboardErrorBoundary>,
    )
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error)
    expect((onError.mock.calls[0][0] as Error).message).toMatch(/수식 평가 실패/)
  })
```

(`vi` is already imported at the top of this file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sdf/host-twin test -- DashboardErrorBoundary.test.tsx`
Expected: FAIL — TypeScript error (`onError` doesn't exist on `Props`) or, if that's not caught by vitest's transform, a runtime failure because `onError` is never called (`toHaveBeenCalledTimes(1)` fails with 0 calls)

- [ ] **Step 3: Write minimal implementation**

Modify `packages/ui/src/DashboardErrorBoundary.tsx`. Change the `Props` interface:

```tsx
interface Props {
  children: ReactNode
  label?: string
  onError?: (error: Error) => void
}
```

Change `componentDidCatch`:

```tsx
  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[DashboardErrorBoundary]", error, info.componentStack)
    this.props.onError?.(error)
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sdf/host-twin test -- DashboardErrorBoundary.test.tsx`
Expected: PASS (all 5 tests — 4 pre-existing + 1 new)

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/DashboardErrorBoundary.tsx apps/host-twin/__tests__/DashboardErrorBoundary.test.tsx
git commit -m "feat(ui): add optional onError prop to DashboardErrorBoundary"
```

---

### Task 7: Frontend — `PluginRegistry` render-error tracking

**Files:**
- Modify: `packages/plugin-runtime/src/registry.ts`
- Modify: `packages/plugin-runtime/src/index.ts`
- Modify: `packages/plugin-runtime/src/__tests__/registry.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block at the end of `packages/plugin-runtime/src/__tests__/registry.test.tsx`:

```ts
describe("PluginRegistry — render errors", () => {
  it("getRenderErrors() returns an empty array for a panel with no recorded errors", () => {
    const registry = new PluginRegistry()
    expect(registry.getRenderErrors("demo")).toEqual([])
  })

  it("recordRenderError() adds an entry retrievable via getRenderErrors() and getAllRenderErrors()", () => {
    const registry = new PluginRegistry()
    registry.recordRenderError("demo", { message: "boom", ts: 123 })
    expect(registry.getRenderErrors("demo")).toEqual([{ message: "boom", ts: 123 }])
    expect(registry.getAllRenderErrors()).toEqual(new Map([["demo", [{ message: "boom", ts: 123 }]]]))
  })

  it("getRenderErrors()/getAllRenderErrors() return defensive copies", () => {
    const registry = new PluginRegistry()
    registry.recordRenderError("demo", { message: "boom", ts: 1 })
    const errors = registry.getRenderErrors("demo")
    errors.push({ message: "mutated", ts: 2 })
    expect(registry.getRenderErrors("demo")).toEqual([{ message: "boom", ts: 1 }])
  })

  it("getPanelComponents() records a render error when a panel component throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const registry = new PluginRegistry()
    registry.registerPanelComponent("boom", () => {
      throw new Error("plugin exploded")
    })
    const panels = registry.getPanelComponents(fakeProps)
    render(<div>{panels["boom"]}</div>)
    expect(registry.getRenderErrors("boom")).toEqual([
      { message: "plugin exploded", ts: expect.any(Number) },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sdf/plugin-runtime test -- registry.test.tsx`
Expected: FAIL — `registry.getRenderErrors is not a function`

- [ ] **Step 3: Write minimal implementation**

In `packages/plugin-runtime/src/registry.ts`, add this type export near the other type exports at the top of the file:

```ts
export interface PanelRenderError {
  message: string
  ts: number
}
```

Add a new private field to the `PluginRegistry` class:

```ts
  private renderErrors = new Map<string, PanelRenderError[]>()
```

Add three new methods (e.g. after `getAllErrors`):

```ts
  recordRenderError(panelId: string, error: PanelRenderError): void {
    const list = this.renderErrors.get(panelId) ?? []
    list.push(error)
    this.renderErrors.set(panelId, list)
  }

  getRenderErrors(panelId: string): PanelRenderError[] {
    return [...(this.renderErrors.get(panelId) ?? [])]
  }

  getAllRenderErrors(): Map<string, PanelRenderError[]> {
    return new Map(Array.from(this.renderErrors, ([id, list]) => [id, [...list]]))
  }
```

Modify `getPanelComponents` to wire in the `onError` callback:

```ts
  getPanelComponents(props: PluginProps): Record<string, ReactNode> {
    const result: Record<string, ReactNode> = {}
    for (const [id, component] of this.panelComponents.entries()) {
      result[id] = createElement(DashboardErrorBoundary, {
        label: id,
        onError: (error: Error) => this.recordRenderError(id, { message: error.message, ts: Date.now() }),
        children: createElement(PanelRenderer, { component, props }),
      })
    }
    return result
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sdf/plugin-runtime test -- registry.test.tsx`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Export the new type**

Modify `packages/plugin-runtime/src/index.ts` — change the `PluginRegistry` export line to also export `PanelRenderError`:

```ts
export { PluginRegistry, type PluginError, type PluginErrorKind, type PluginSummary, type PanelRenderError } from "./registry"
```

- [ ] **Step 6: Run the full package test suite and typecheck**

Run: `pnpm --filter @sdf/plugin-runtime test && pnpm --filter @sdf/plugin-runtime typecheck`
Expected: PASS, no errors

- [ ] **Step 7: Commit**

```bash
git add packages/plugin-runtime/src/registry.ts packages/plugin-runtime/src/index.ts packages/plugin-runtime/src/__tests__/registry.test.tsx
git commit -m "feat(plugin-runtime): track panel render errors, wire onError into getPanelComponents"
```

---

### Task 8: Frontend — `factoryStore` backend error slice

**Files:**
- Modify: `apps/host-twin/store/factoryStore.ts`
- Modify: `apps/host-twin/__tests__/factoryStore.test.ts`

- [ ] **Step 1: Write the failing test**

Add this new `describe` block to `apps/host-twin/__tests__/factoryStore.test.ts` (append at the end of the file):

```ts
describe("addBackendPluginError", () => {
  it("appends to backendPluginErrors", () => {
    useFactoryStore.getState().addBackendPluginError({
      source: "collector",
      id: "c1",
      message: "boom",
      ts: 1000,
    })
    expect(useFactoryStore.getState().backendPluginErrors).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sdf/host-twin test -- factoryStore.test.ts`
Expected: FAIL — `useFactoryStore.getState().addBackendPluginError is not a function`

- [ ] **Step 3: Write minimal implementation**

In `apps/host-twin/store/factoryStore.ts`, add `PluginErrorEvent` to the existing `@sdf/types` import list at the top of the file.

Add to the store's interface (near `agentEvents: AgentEvent[]` / `addAgentEvent: (event: AgentEvent) => void`):

```ts
  backendPluginErrors: PluginErrorEvent[]
  addBackendPluginError: (event: PluginErrorEvent) => void
```

Add to the initial state (near `agentEvents: [],`):

```ts
  backendPluginErrors: [],
```

Add the action (near `addAgentEvent`):

```ts
  addBackendPluginError: (event) =>
    set((state) => ({ backendPluginErrors: [...state.backendPluginErrors, event] })),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sdf/host-twin test -- factoryStore.test.ts`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Commit**

```bash
git add apps/host-twin/store/factoryStore.ts apps/host-twin/__tests__/factoryStore.test.ts
git commit -m "feat(host-twin): add backendPluginErrors store slice"
```

---

### Task 9: Frontend — route `plugin_error` WS messages

**Files:**
- Modify: `apps/host-twin/hooks/useWebSocket.ts`

- [ ] **Step 1: Add the routing branch**

In `apps/host-twin/hooks/useWebSocket.ts`, in the batch-processing `for (const msg of batch)` loop's `else if` chain (the one handling `"agent_event"`, `"alert"`, `"robot_dispatch"`, `"machine_detail"`, `"robot_path"`, `"component_fault"`), add a new branch after the `"component_fault"` one:

```ts
          } else if (msg.type === "plugin_error") {
            store.addBackendPluginError(msg.payload)
          }
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @sdf/host-twin typecheck`
Expected: no errors (confirms `msg.payload` narrows to `PluginErrorEvent` for this branch, matching `addBackendPluginError`'s parameter type)

**No dedicated test for this step.** `useWebSocket.ts` has no test file in this codebase at all — none of its other 7 message-type branches (`sensor_update`, `agent_event`, `alert`, `robot_dispatch`, `machine_detail`, `robot_path`, `component_fault`) have direct unit test coverage either (confirmed: no file in the repo imports `useWebSocket`). Adding test infrastructure for this one hook, for just this one branch, while 7 existing branches stay untested, would be inconsistent scope creep — this one-line addition is mechanical and follows the exact same pattern as its 7 neighbors. Coverage instead comes from `factoryStore.test.ts` (Task 8, the actual state mutation) and `PluginInspectorPanel.test.tsx` (Task 10, the actual display).

- [ ] **Step 3: Commit**

```bash
git add apps/host-twin/hooks/useWebSocket.ts
git commit -m "feat(host-twin): route plugin_error WS messages to the store"
```

---

### Task 10: Frontend — extend `PluginInspectorPanel` with two new sections

**Files:**
- Modify: `apps/host-twin/components/PluginInspectorPanel.tsx`
- Modify: `apps/host-twin/__tests__/PluginInspectorPanel.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add these three tests to `apps/host-twin/__tests__/PluginInspectorPanel.test.tsx`, inside the existing `describe("PluginInspectorPanel", ...)` block (after the existing 6 tests):

```tsx
  it("shows panel render errors under a '패널 렌더링 에러' section", () => {
    const registry = new PluginRegistry()
    registry.recordRenderError("demo-panel", { message: "render boom", ts: 1 })
    render(<PluginInspectorPanel registry={registry} />)
    expect(screen.getByText("패널 렌더링 에러")).toBeInTheDocument()
    expect(screen.getByText("demo-panel")).toBeInTheDocument()
    expect(screen.getByText("render boom")).toBeInTheDocument()
  })

  it("shows backend errors under a '백엔드 에러' section", () => {
    render(
      <PluginInspectorPanel
        registry={new PluginRegistry()}
        backendErrors={[{ source: "collector", id: "c1", message: "collect failed", ts: 1 }]}
      />,
    )
    expect(screen.getByText("백엔드 에러")).toBeInTheDocument()
    expect(screen.getByText("Collector")).toBeInTheDocument()
    expect(screen.getByText("c1")).toBeInTheDocument()
    expect(screen.getByText("collect failed")).toBeInTheDocument()
  })

  it("does not show the render-error or backend-error sections when there are none", () => {
    render(<PluginInspectorPanel registry={new PluginRegistry()} />)
    expect(screen.queryByText("패널 렌더링 에러")).not.toBeInTheDocument()
    expect(screen.queryByText("백엔드 에러")).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sdf/host-twin test -- PluginInspectorPanel.test.tsx`
Expected: FAIL — the 3 new tests fail (sections don't exist yet); the 6 pre-existing tests still pass

- [ ] **Step 3: Write minimal implementation**

Modify `apps/host-twin/components/PluginInspectorPanel.tsx`. Change the imports at the top:

```tsx
"use client"
import { useCallback, useState } from "react"
import type { PluginError, PluginRegistry, PluginSummary, PanelRenderError } from "@sdf/plugin-runtime"
import type { PluginErrorEvent } from "@sdf/types"
```

Change the `Snapshot` interface and `readSnapshot`:

```tsx
interface Snapshot {
  summaries: PluginSummary[]
  errors: Map<string, PluginError[]>
  renderErrors: Map<string, PanelRenderError[]>
}

function readSnapshot(registry: PluginRegistry): Snapshot {
  return {
    summaries: registry.list(),
    errors: registry.getAllErrors(),
    renderErrors: registry.getAllRenderErrors(),
  }
}
```

Change the component signature to accept `backendErrors` (optional, defaulting to `[]` so the 6 pre-existing tests — which don't pass this prop — keep working unchanged):

```tsx
export function PluginInspectorPanel({
  registry,
  backendErrors = [],
}: {
  registry: PluginRegistry
  backendErrors?: PluginErrorEvent[]
}) {
```

Add two new sections in the JSX, after the existing `<div className="space-y-2">...</div>` block that renders `active`/`rejected` plugins, but still inside the component's outermost `<div className="bg-gray-900 rounded-xl p-4 space-y-3">`:

```tsx
      {snapshot.renderErrors.size > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">패널 렌더링 에러</h3>
          {Array.from(snapshot.renderErrors.entries()).map(([panelId, errors]) => (
            <div key={panelId} className="border border-gray-800 rounded-lg p-3 space-y-1.5">
              <span className="text-gray-400 text-[10px] font-mono">{panelId}</span>
              {errors.map((err, i) => (
                <div key={i} className="flex items-start gap-2 text-[11px]">
                  <span className="px-1.5 py-0.5 rounded bg-fuchsia-900/40 text-fuchsia-300 text-[10px] font-medium flex-shrink-0">
                    렌더링 실패
                  </span>
                  <span className="text-gray-500">{err.message}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {backendErrors.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">백엔드 에러</h3>
          {backendErrors.map((event, i) => (
            <div key={i} className="border border-gray-800 rounded-lg p-3 space-y-1.5">
              <div className="flex items-baseline gap-2">
                <span className="px-1.5 py-0.5 rounded bg-fuchsia-900/40 text-fuchsia-300 text-[10px] font-medium">
                  {event.source === "collector" ? "Collector" : "PipelineStage"}
                </span>
                <span className="text-gray-400 text-[10px] font-mono">{event.id}</span>
              </div>
              <p className="text-gray-500 text-[11px]">{event.message}</p>
            </div>
          ))}
        </div>
      )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sdf/host-twin test -- PluginInspectorPanel.test.tsx`
Expected: PASS (all 9 tests — 6 pre-existing + 3 new)

- [ ] **Step 5: Run the full host-twin test suite and typecheck**

Run: `pnpm --filter @sdf/host-twin test && pnpm --filter @sdf/host-twin typecheck`
Expected: PASS, no errors

- [ ] **Step 6: Commit**

```bash
git add apps/host-twin/components/PluginInspectorPanel.tsx apps/host-twin/__tests__/PluginInspectorPanel.test.tsx
git commit -m "feat(host-twin): show panel render errors and backend errors in PluginInspectorPanel"
```

---

### Task 11: Frontend — wire `backendErrors` prop in `page.tsx`

**Files:**
- Modify: `apps/host-twin/app/page.tsx`

- [ ] **Step 1: Read backend errors from the store**

In `apps/host-twin/app/page.tsx`, add a new store-slice const near the other `useFactoryStore((s) => ...)` calls in `Home` (e.g. near `const selectedId = useFactoryStore((s) => s.selectedEntityId)`):

```tsx
  const backendPluginErrors = useFactoryStore((s) => s.backendPluginErrors)
```

- [ ] **Step 2: Pass it to `PluginInspectorPanel`**

Change the `inspector` entry in `panelContent` from:

```tsx
    inspector: (
      <DashboardErrorBoundary label="플러그인 인스펙터">
        <PluginInspectorPanel key={pluginsReady ? "ready" : "loading"} registry={pluginRegistry} />
      </DashboardErrorBoundary>
    ),
```

to:

```tsx
    inspector: (
      <DashboardErrorBoundary label="플러그인 인스펙터">
        <PluginInspectorPanel
          key={pluginsReady ? "ready" : "loading"}
          registry={pluginRegistry}
          backendErrors={backendPluginErrors}
        />
      </DashboardErrorBoundary>
    ),
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @sdf/host-twin typecheck`
Expected: no errors

(No dedicated test — same reasoning as Task 8 of the Phase 3b plan: `page.tsx` has no test file in this codebase, and coverage comes from `PluginInspectorPanel.test.tsx`'s prop-driven tests plus `factoryStore.test.ts`'s `addBackendPluginError` test.)

- [ ] **Step 4: Commit**

```bash
git add apps/host-twin/app/page.tsx
git commit -m "feat(host-twin): wire backendPluginErrors into PluginInspectorPanel"
```

---

### Task 12: Full-repo verification

**Files:** none (verification only), except a small roadmap doc update at the end.

- [ ] **Step 1: Typecheck every workspace package**

Run: `pnpm typecheck`
Expected: no errors in any of the 5 frontend packages.

- [ ] **Step 2: Run every workspace test suite (frontend)**

Run: `pnpm test`
Expected: all frontend suites pass.

- [ ] **Step 3: Run the backend test suite**

Run: `apps/backend-sim/.venv/Scripts/python.exe -m pytest apps/backend-sim/tests/ -v`
Expected: all tests pass (pre-existing 48 + this plan's additions from Tasks 1-3: 2 + 2 + 5 = 9 new tests, 57 total — confirm the actual count in the output rather than assuming).

- [ ] **Step 4: Production build**

Run: `pnpm build`
Expected: clean build.

- [ ] **Step 5: Update the roadmap doc**

In `docs/superpowers/specs/2026-07-22-plugin-platform-roadmap-v2.md`, update the Phase 6 section (search for "Phase 6") to mark it complete, following the same phrasing pattern used for Phase 3b's completion note (구현 완료, PR 미생성, referencing this plan's design spec and implementation plan file paths). Update the dependency diagram at the bottom if its Phase 6 annotation needs updating.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-07-22-plugin-platform-roadmap-v2.md
git commit -m "docs: mark Phase 6 (Plugin Monitoring Dashboard) complete in roadmap"
```

---

## Self-Review Notes

- **Spec coverage:** Design doc §3.1 (DashboardErrorBoundary) → Task 6. §3.2 (PluginRegistry render errors) → Task 7. §4.1 (backend error storage) → Tasks 1-2. §4.2 (WSMessage type) → Task 5. §4.3 (detect-and-push) → Tasks 3-4. §5 (WS → store) → Tasks 8-9. §6 (UI) → Task 10-11. §9 (backlog: uncapped error growth) — deliberately NOT implemented, matches the design's explicit decision to defer it.
- **Placeholder scan:** No TBD/TODO. Task 4 and Task 9 both explicitly justify why they have no dedicated test (matching pre-existing codebase conventions — `simulation_loop`/`useWebSocket.ts` are both untested as a matter of established practice, not an oversight) rather than silently skipping test steps.
- **Type consistency:** `PluginErrorEvent` (Task 5, `@sdf/types`) is referenced identically in Task 8 (`factoryStore.ts`), Task 9 (`useWebSocket.ts`), and Task 10 (`PluginInspectorPanel.tsx`). `PanelRenderError` (Task 7, `@sdf/plugin-runtime`) is referenced identically in Task 10. The backend's `detect_new_plugin_errors()` (Task 3) returns plain `dict` (matching this codebase's existing convention of constructing WS-bound messages as plain dicts in `main.py`, e.g. `{"type": "anomaly_detected", "machineId": mid}`) rather than a dataclass — the design doc's Python sketch used a dataclass for illustration, but the actual shape (`source`/`id`/`message`/`ts` keys) is preserved exactly, matching the `PluginErrorEvent` TS interface field-for-field.
