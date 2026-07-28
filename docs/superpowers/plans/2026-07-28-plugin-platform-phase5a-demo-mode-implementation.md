# Phase 5a — WS 스트림 모킹 데모 모드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit "demo mode" toggle — exposed through a new plugin panel — that makes the app run entirely on the pre-existing `useSimulator` mock generator instead of a real backend WebSocket connection, with zero changes to `useSimulator.ts` itself.

**Architecture:** A new `demoMode` boolean lives in `factoryStore`. `useWebSocket` gains a `demoMode` parameter that, when true, skips opening a real socket and reports a new `"demo"` status instead — which makes `wsStatus === "connected"` false, so the *already-existing* `useSimulator({ wsConnected })` auto-fallback kicks in unchanged. `PluginProps` gains its first-ever write method (`setDemoMode`) so a new `demoControllerPlugin` panel can flip the flag from a button click.

**Tech Stack:** TypeScript, React, Zustand, Vitest + @testing-library/react.

**Design spec:** `docs/superpowers/specs/2026-07-28-plugin-platform-phase5a-demo-mode-design.md`

---

### Task 1: `PluginProps.setDemoMode` — the shared type + plugin-runtime wiring

**Files:**
- Modify: `packages/types/src/index.ts`
- Modify: `packages/plugin-runtime/src/context.ts`
- Test: `packages/plugin-runtime/src/__tests__/context.test.ts`

This task adds the new capability to the two shared packages every other task builds on. It also fixes the one existing test file that asserts `PluginProps`'s *exact* key set and constructs a fully-typed `PluginProps` literal — both of which break the moment `setDemoMode` becomes a required field. (Five *other* test files across the repo also construct `PluginContextBindings`-shaped literals and will have expected, tracked typecheck failures until Task 6 — this is intentional, matching how Phase 4's `PluginInspectorPanel` prop addition was staged across tasks. Don't fix them here.)

- [ ] **Step 1: Write the failing tests**

In `packages/plugin-runtime/src/__tests__/context.test.ts`, make three changes:

1. Update the `fakeProps` literal (near the top of the file) to include the new field:

```ts
const fakeProps: PluginProps = {
  useStoreSlice: (selector) => selector(undefined),
  setDemoMode: () => {},
}
```

2. Update `makeBindings()` to include the new field:

```ts
function makeBindings() {
  return {
    getReadOnlyState: vi.fn(() => ({ machines: {} })),
    subscribe: vi.fn(() => () => {}),
    addRule: vi.fn(),
    addComputedMetric: vi.fn(),
    registerPanelPosition: vi.fn(),
    setDemoMode: vi.fn(),
  }
}
```

3. In the `describe("createPluginProps", ...)` block, update the exact-key-set test and add a new delegation test:

```ts
  it("exposes exactly the useStoreSlice and setDemoMode keys", () => {
    const props = createPluginProps(makeBindings())
    expect(Object.keys(props).sort()).toEqual(["setDemoMode", "useStoreSlice"].sort())
  })

  it("setDemoMode delegates to bindings.setDemoMode", () => {
    const bindings = makeBindings()
    const props = createPluginProps(bindings)
    props.setDemoMode(true)
    expect(bindings.setDemoMode).toHaveBeenCalledWith(true)
  })
```

Replace the OLD test named `"exposes exactly the useStoreSlice key"` with the new `"exposes exactly the useStoreSlice and setDemoMode keys"` test above (don't leave both — the old one will fail once the new field exists).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/plugin-runtime && pnpm vitest run src/__tests__/context.test.ts`
Expected: FAIL — `Property 'setDemoMode' is missing` (TypeScript) or the key-set assertion mismatches, since `PluginProps`/`PluginContextBindings` don't have the field yet.

- [ ] **Step 3: Add the field to the shared types and wire it through**

In `packages/types/src/index.ts`, find the `PluginProps` interface and change it to:

```ts
export interface PluginProps {
  /**
   * Subscribes to a slice of the host store via a selector. The component
   * only re-renders when the selected value actually changes (compared with
   * deep equality, since the host store clones its full state on every
   * update, so reference equality would never bypass a re-render), not on
   * every host store update. `state` is typed `unknown` — plugin-runtime has
   * no dependency on the host app's concrete store shape, so plugin authors
   * cast to whatever shape they know at the call site.
   */
  useStoreSlice: <T>(selector: (state: unknown) => T) => T
  /**
   * Turns demo mode on or off. When on, the host skips connecting to the
   * real backend WebSocket and the pre-existing frontend-only mock simulator
   * (`useSimulator`) takes over automatically — this method only flips that
   * switch, it doesn't generate any data itself. This is the first write
   * capability ever exposed on `PluginProps`, so it's kept narrow and
   * purpose-specific (not a general dispatch mechanism).
   */
  setDemoMode: (enabled: boolean) => void
}
```

In `packages/plugin-runtime/src/context.ts`, update `PluginContextBindings` and `createPluginProps`:

```ts
export interface PluginContextBindings {
  getReadOnlyState: () => unknown
  subscribe: (listener: (state: unknown) => void) => () => void
  addRule: (rule: Omit<Rule, "id" | "lastTriggeredAt">) => void
  addComputedMetric: (metric: Omit<ComputedMetric, "id">) => void
  registerPanelPosition: (
    id: string,
    label: string,
    defaultPosition?: PluginPanel["defaultPosition"],
  ) => void
  setDemoMode: (enabled: boolean) => void
}
```

```ts
export function createPluginProps(bindings: PluginContextBindings): PluginProps {
  return {
    useStoreSlice: createUseStoreSlice(bindings.getReadOnlyState, bindings.subscribe),
    setDemoMode: bindings.setDemoMode,
  }
}
```

(Leave `createPluginContext` and everything else in the file untouched.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/plugin-runtime && pnpm vitest run src/__tests__/context.test.ts`
Expected: PASS — all tests in this file.

Also run `cd packages/plugin-runtime && pnpm typecheck` — expect it to pass (this package's own code is now consistent). Running `pnpm typecheck` from the repo root at this point will show FAILURES in `apps/host-twin` and in `packages/plugin-runtime/src/__tests__/loader.test.ts` — this is expected and tracked; Task 6 fixes them. Don't fix them now.

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/index.ts packages/plugin-runtime/src/context.ts packages/plugin-runtime/src/__tests__/context.test.ts
git commit -m "feat(plugin-runtime): add PluginProps.setDemoMode, the first plugin write capability"
```

---

### Task 2: `factoryStore` — `demoMode` state

**Files:**
- Modify: `apps/host-twin/store/factoryStore.ts`
- Test: `apps/host-twin/__tests__/factoryStore.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `apps/host-twin/__tests__/factoryStore.test.ts` (a new `describe` block, anywhere after the existing ones):

```ts
describe("demoMode", () => {
  it("defaults to false", () => {
    expect(useFactoryStore.getState().demoMode).toBe(false)
  })

  it("setDemoMode toggles it", () => {
    useFactoryStore.getState().setDemoMode(true)
    expect(useFactoryStore.getState().demoMode).toBe(true)
    useFactoryStore.getState().setDemoMode(false)
    expect(useFactoryStore.getState().demoMode).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/host-twin && pnpm vitest run __tests__/factoryStore.test.ts`
Expected: FAIL — `demoMode`/`setDemoMode` don't exist on the store yet.

- [ ] **Step 3: Add `demoMode` to the store**

In `apps/host-twin/store/factoryStore.ts`, find the `FactoryStore` interface's first block (starting with `// 기존 실시간 데이터`) and add two lines right after `setDispatchCommand: (cmd: DispatchCommand | null) => void`:

```ts
  setDispatchCommand: (cmd: DispatchCommand | null) => void
  demoMode: boolean
  setDemoMode: (enabled: boolean) => void
```

Then find the store initializer (`export const useFactoryStore = create<FactoryStore>((set, get) => ({`) and add two lines right after `dispatchCommand: null,` (before the `applySnapshot: (snapshot) => {` line):

```ts
  dispatchCommand: null,
  demoMode: false,
  setDemoMode: (enabled) => set({ demoMode: enabled }),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/host-twin && pnpm vitest run __tests__/factoryStore.test.ts`
Expected: PASS — all tests in this file (including the 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add apps/host-twin/store/factoryStore.ts apps/host-twin/__tests__/factoryStore.test.ts
git commit -m "feat(host-twin): add demoMode state to factoryStore"
```

---

### Task 3: `useWebSocket` — `demoMode` parameter

**Files:**
- Modify: `apps/host-twin/hooks/useWebSocket.ts`

No dedicated test for this file — it has zero tests today (an established "thin glue" convention already used for `useWebSocket`/Web Worker wrappers elsewhere in this codebase). This task is verified by Task 4's manual smoke check once it's wired into `page.tsx`, plus the full existing test suite staying green (nothing currently tests `useWebSocket` directly, so nothing can regress from it).

- [ ] **Step 1: Add the `demoMode` parameter and `"demo"` status**

In `apps/host-twin/hooks/useWebSocket.ts`, change the `WsStatus` type:

```ts
export type WsStatus = "connecting" | "connected" | "disconnected" | "error" | "demo"
```

Change the function signature to insert `demoMode` as the second parameter, right after `url`:

```ts
export function useWebSocket(
  url: string,
  demoMode: boolean,
  robotPosRef?: React.MutableRefObject<RobotPositionRef>,
  machineGroupsRef?: React.MutableRefObject<MachineGroupRef>,
  updatePathLine?: (robotId: string, path: [number, number][]) => void,
  clearPathLine?: (robotId: string) => void,
  updateComponentFault?: (machineId: string, faults: Record<string, { severity: "warn" | "critical" }>) => void,
  updateRobotPath?: (robotId: string, waypoints: [number, number][]) => void,
) {
```

Inside the main `useEffect`, add a `demoMode` early-return branch as the very first thing after `let active = true`, BEFORE the `const connect = () => { ... }` declaration:

```ts
  useEffect(() => {
    let active = true

    if (demoMode) {
      setStatus("demo")
      const ws = wsRef.current
      if (ws) { ws.close(); wsRef.current = null }
      return () => { active = false }
    }

    const connect = () => {
      // ... existing connect() body, completely unchanged ...
```

Leave the entire `connect` function body, the `drain` function, and the final `return () => { ... }` cleanup at the bottom of the effect exactly as they are today — do not modify a single line inside them.

Finally, change the effect's dependency array from `[url]` to `[url, demoMode]`:

```ts
  }, [url, demoMode])
```

- [ ] **Step 2: Verify nothing else broke**

Run: `cd apps/host-twin && pnpm typecheck`
Expected: this specific file now typechecks correctly. The repo-wide `pnpm typecheck` from root will still show the Task 6-tracked failures in the 5 other test files — that's expected, don't fix them here. `page.tsx`'s call site to `useWebSocket` is now also broken (missing the new required `demoMode` argument) — that's fixed in Task 4, not here.

- [ ] **Step 3: Commit**

```bash
git add apps/host-twin/hooks/useWebSocket.ts
git commit -m "feat(host-twin): add demoMode parameter to useWebSocket"
```

---

### Task 4: Wire `demoMode` into `page.tsx` and `pluginBootstrap.ts`

**Files:**
- Modify: `apps/host-twin/app/page.tsx`
- Modify: `apps/host-twin/lib/pluginBootstrap.ts`

- [ ] **Step 1: Update the `useWebSocket` call site and status badge in `page.tsx`**

Find this block in `apps/host-twin/app/page.tsx`:

```tsx
  const { status: wsStatus } = useWebSocket(
    WS_URL, robotPosRef, machineGroupsRef,
    updatePathLine, clearPathLine, updateComponentFault, updateRobotPath,
  )

  useSimulator({ wsConnected: wsStatus === "connected" })
```

Replace it with:

```tsx
  const demoMode = useFactoryStore((s) => s.demoMode)
  const { status: wsStatus } = useWebSocket(
    WS_URL, demoMode, robotPosRef, machineGroupsRef,
    updatePathLine, clearPathLine, updateComponentFault, updateRobotPath,
  )

  useSimulator({ wsConnected: wsStatus === "connected" })
```

(`useFactoryStore` is already imported in this file for other selectors — reuse the existing import, don't add a new one.)

Find the WS status badge block:

```tsx
        <span className={`text-xs px-2 py-0.5 rounded-full font-mono ${
          wsStatus === "connected"  ? "bg-green-900 text-green-400" :
          wsStatus === "connecting" ? "bg-yellow-900 text-yellow-400" :
          wsStatus === "error"      ? "bg-red-900 text-red-400" :
                                      "bg-gray-800 text-gray-500"
        }`}>
          {wsStatus === "connected"  ? "● 연결됨" :
           wsStatus === "connecting" ? "○ 연결 중..." :
           wsStatus === "error"      ? "✕ 오류" : "✕ 연결 끊김"}
        </span>
```

Replace it with:

```tsx
        <span className={`text-xs px-2 py-0.5 rounded-full font-mono ${
          wsStatus === "connected"  ? "bg-green-900 text-green-400" :
          wsStatus === "connecting" ? "bg-yellow-900 text-yellow-400" :
          wsStatus === "demo"       ? "bg-purple-900 text-purple-400" :
          wsStatus === "error"      ? "bg-red-900 text-red-400" :
                                      "bg-gray-800 text-gray-500"
        }`}>
          {wsStatus === "connected"  ? "● 연결됨" :
           wsStatus === "connecting" ? "○ 연결 중..." :
           wsStatus === "demo"       ? "🎬 데모 모드" :
           wsStatus === "error"      ? "✕ 오류" : "✕ 연결 끊김"}
        </span>
```

- [ ] **Step 2: Add the `setDemoMode` binding**

In `apps/host-twin/lib/pluginBootstrap.ts`, find `createHostBindings()`'s returned object (it currently ends with `registerPanelPosition: (id, label, pos) => useFactoryStore.getState().registerPluginPanel(id, label, pos),`). Add a new entry right after it:

```ts
    registerPanelPosition: (id, label, pos) =>
      useFactoryStore.getState().registerPluginPanel(id, label, pos),
    setDemoMode: (enabled) => useFactoryStore.getState().setDemoMode(enabled),
```

- [ ] **Step 3: Verify the whole app typechecks**

Run: `cd apps/host-twin && pnpm typecheck`
Expected: PASS, zero errors in this package now (the `useWebSocket` call site and the bindings object are both fixed). The Task 6-tracked 5 test-file failures are in other files and don't affect this command's result for the app code itself — but if you run `pnpm typecheck` and see failures ONLY in `__tests__/*.test.tsx` files (not in `page.tsx`, `pluginBootstrap.ts`, or `useWebSocket.ts`), that's the expected, already-tracked Task 6 work — leave those alone.

- [ ] **Step 4: Run the full host-twin test suite to confirm no regressions in non-cascade files**

Run: `cd apps/host-twin && pnpm vitest run`
Expected: the newly-passing files (factoryStore, everything not touching `PluginContextBindings` literals) pass. The 5 cascade-affected test files (`alertLogPlugin.test.tsx`, `sensorChartPlugin.test.tsx`, `sessionRecorderPlugin.test.tsx`, `PluginInspectorPanel.test.tsx`) will fail to even compile/collect at this point — that's Task 6's job, don't fix them here.

- [ ] **Step 5: Commit**

```bash
git add apps/host-twin/app/page.tsx apps/host-twin/lib/pluginBootstrap.ts
git commit -m "feat(host-twin): wire demoMode through page.tsx and plugin bindings"
```

---

### Task 5: `demoControllerPlugin` — the panel

**Files:**
- Create: `apps/host-twin/plugins/demoControllerPlugin.tsx`
- Test: `apps/host-twin/plugins/__tests__/demoControllerPlugin.test.tsx`
- Modify: `apps/host-twin/lib/plugins.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/host-twin/plugins/__tests__/demoControllerPlugin.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { createPluginProps } from "@sdf/plugin-runtime"
import { DemoControllerPanel } from "../demoControllerPlugin"

function makeFakeBindings(demoMode: boolean) {
  const state = { demoMode }
  return {
    getReadOnlyState: () => state,
    subscribe: () => () => {},
    addRule: () => {},
    addComputedMetric: () => {},
    registerPanelPosition: () => {},
    setDemoMode: vi.fn(),
  }
}

describe("DemoControllerPanel", () => {
  it("shows the 'start demo' state and label when demo mode is off", () => {
    const props = createPluginProps(makeFakeBindings(false))
    render(<DemoControllerPanel {...props} />)
    expect(screen.getByText("실제 백엔드 연결 중")).toBeInTheDocument()
    expect(screen.getByText("데모 모드 시작")).toBeInTheDocument()
  })

  it("shows the 'stop demo' state and label when demo mode is on", () => {
    const props = createPluginProps(makeFakeBindings(true))
    render(<DemoControllerPanel {...props} />)
    expect(screen.getByText("데모 모드 실행 중 — 모킹 데이터를 표시합니다")).toBeInTheDocument()
    expect(screen.getByText("데모 모드 종료")).toBeInTheDocument()
  })

  it("calls setDemoMode(true) when clicked while off", () => {
    const bindings = makeFakeBindings(false)
    const props = createPluginProps(bindings)
    render(<DemoControllerPanel {...props} />)
    fireEvent.click(screen.getByText("데모 모드 시작"))
    expect(bindings.setDemoMode).toHaveBeenCalledWith(true)
  })

  it("calls setDemoMode(false) when clicked while on", () => {
    const bindings = makeFakeBindings(true)
    const props = createPluginProps(bindings)
    render(<DemoControllerPanel {...props} />)
    fireEvent.click(screen.getByText("데모 모드 종료"))
    expect(bindings.setDemoMode).toHaveBeenCalledWith(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/host-twin && pnpm vitest run plugins/__tests__/demoControllerPlugin.test.tsx`
Expected: FAIL — `../demoControllerPlugin` doesn't exist yet.

- [ ] **Step 3: Create the plugin**

Create `apps/host-twin/plugins/demoControllerPlugin.tsx`:

```tsx
"use client"
import type { PluginProps, SDFPlugin } from "@sdf/types"

interface FactoryStoreShape {
  demoMode: boolean
}

export function DemoControllerPanel(props: PluginProps) {
  const demoMode = props.useStoreSlice((s) => (s as FactoryStoreShape).demoMode)

  return (
    <div className="bg-gray-900 rounded-lg p-3 space-y-2">
      <p className="text-xs text-gray-400">
        {demoMode ? "데모 모드 실행 중 — 모킹 데이터를 표시합니다" : "실제 백엔드 연결 중"}
      </p>
      <button
        onClick={() => props.setDemoMode(!demoMode)}
        className={`w-full py-1.5 rounded-lg text-xs font-medium ${
          demoMode
            ? "bg-red-900/60 hover:bg-red-900 text-red-300 border border-red-800"
            : "bg-purple-900/60 hover:bg-purple-900 text-purple-300 border border-purple-800"
        }`}
      >
        {demoMode ? "데모 모드 종료" : "데모 모드 시작"}
      </button>
    </div>
  )
}

export const demoControllerPlugin: SDFPlugin = {
  id: "demo-controller",
  name: "Demo Controller",
  version: "0.1.0",
  activate: (ctx) => {
    ctx.registerPanel({
      id: "demo-controller-panel",
      label: "데모 컨트롤러",
      component: (props) => <DemoControllerPanel {...props} />,
    })
  },
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/host-twin && pnpm vitest run plugins/__tests__/demoControllerPlugin.test.tsx`
Expected: PASS — all 4 tests.

- [ ] **Step 5: Register the plugin**

In `apps/host-twin/lib/plugins.ts`, current full content is:

```ts
import type { SDFPlugin } from "@sdf/types"
import { sensorChartPlugin } from "@/plugins/sensorChartPlugin"
import { alertLogPlugin } from "@/plugins/alertLogPlugin"
import { sessionRecorderPlugin } from "@/plugins/sessionRecorderPlugin"

/**
 * Statically installed plugins. Add imported plugin objects to this array
 * to activate them at app boot. (Phase 4 will add a dynamic loader that
 * calls the same PluginRegistry.register() entry point at runtime.)
 */
export const installedPlugins: SDFPlugin[] = [sensorChartPlugin, alertLogPlugin, sessionRecorderPlugin]
```

Replace it with:

```ts
import type { SDFPlugin } from "@sdf/types"
import { sensorChartPlugin } from "@/plugins/sensorChartPlugin"
import { alertLogPlugin } from "@/plugins/alertLogPlugin"
import { sessionRecorderPlugin } from "@/plugins/sessionRecorderPlugin"
import { demoControllerPlugin } from "@/plugins/demoControllerPlugin"

/**
 * Statically installed plugins. Add imported plugin objects to this array
 * to activate them at app boot. Phase 4 added a dynamic loader that calls
 * the same PluginRegistry.register() entry point at runtime for uploaded
 * .js files, on top of this static list.
 */
export const installedPlugins: SDFPlugin[] = [
  sensorChartPlugin,
  alertLogPlugin,
  sessionRecorderPlugin,
  demoControllerPlugin,
]
```

(The comment's stale "Phase 4 will add" future-tense wording is corrected to past tense while it's already being touched — Phase 4 shipped already.)

- [ ] **Step 6: Commit**

```bash
git add apps/host-twin/plugins/demoControllerPlugin.tsx apps/host-twin/plugins/__tests__/demoControllerPlugin.test.tsx apps/host-twin/lib/plugins.ts
git commit -m "feat(host-twin): add demoControllerPlugin panel"
```

---

### Task 6: Fix the `PluginContextBindings`/`PluginProps` cascade in the remaining 6 test files

**Files:**
- Modify: `apps/host-twin/plugins/__tests__/alertLogPlugin.test.tsx`
- Modify: `apps/host-twin/plugins/__tests__/sensorChartPlugin.test.tsx`
- Modify: `apps/host-twin/plugins/__tests__/sessionRecorderPlugin.test.tsx`
- Modify: `apps/host-twin/__tests__/PluginInspectorPanel.test.tsx`
- Modify: `packages/plugin-runtime/src/__tests__/loader.test.ts`
- Modify: `packages/plugin-runtime/src/__tests__/registry.test.tsx`

Since Task 1, these 6 files have been failing to typecheck. Five of them construct a `PluginContextBindings`-shaped object literal missing the new required `setDemoMode` field. The sixth, `registry.test.tsx`, was missed during planning — it constructs a fully-typed `PluginProps` literal directly (`const fakeProps: PluginProps = { useStoreSlice: ... }`, same pattern `context.test.ts` had before Task 1 fixed it), found by Task 1's implementer during its own typecheck verification. Each fix is a single added line — no behavior changes, no new test cases, purely mechanical (same pattern as Phase 4's `PluginInspectorPanel.tsx` prop-cascade fix across its own test file).

- [ ] **Step 1: Add `setDemoMode` to each file's bindings literal**

In `apps/host-twin/plugins/__tests__/alertLogPlugin.test.tsx`, find:
```ts
    registerPanelPosition: () => {},
```
Change to:
```ts
    registerPanelPosition: () => {},
    setDemoMode: () => {},
```

In `apps/host-twin/plugins/__tests__/sensorChartPlugin.test.tsx`, find:
```ts
    registerPanelPosition: () => {},
```
Change to:
```ts
    registerPanelPosition: () => {},
    setDemoMode: () => {},
```

In `apps/host-twin/plugins/__tests__/sessionRecorderPlugin.test.tsx`, find:
```ts
    registerPanelPosition: () => {},
```
Change to:
```ts
    registerPanelPosition: () => {},
    setDemoMode: () => {},
```

In `apps/host-twin/__tests__/PluginInspectorPanel.test.tsx`, find:
```ts
    registerPanelPosition: vi.fn(),
```
Change to:
```ts
    registerPanelPosition: vi.fn(),
    setDemoMode: vi.fn(),
```

In `packages/plugin-runtime/src/__tests__/loader.test.ts`, find:
```ts
    registerPanelPosition: vi.fn(),
```
Change to:
```ts
    registerPanelPosition: vi.fn(),
    setDemoMode: vi.fn(),
```

In `packages/plugin-runtime/src/__tests__/registry.test.tsx`, find (near the top of the file):
```ts
const fakeProps: PluginProps = {
  useStoreSlice: (selector) => selector(undefined),
}
```
Change to:
```ts
const fakeProps: PluginProps = {
  useStoreSlice: (selector) => selector(undefined),
  setDemoMode: () => {},
}
```
(Read the file first to confirm the exact current selector implementation inside `useStoreSlice` — it may differ slightly from what's shown here — and only add the new `setDemoMode` line, don't change anything else in the literal.)

- [ ] **Step 2: Run the full test suite and typecheck to confirm everything is clean**

Run: `pnpm typecheck` (repo root)
Expected: PASS, zero errors across every package.

Run: `pnpm test` (repo root)
Expected: PASS. Expected counts: `@sdf/plugin-runtime` 46 tests (45 pre-existing + 1 new delegation test from Task 1), `@sdf/host-twin` 94 tests (88 pre-existing + 2 from Task 2 + 4 from Task 5), `@sdf/backend-sim` 74 tests (untouched by this phase).

- [ ] **Step 3: Commit**

```bash
git add apps/host-twin/plugins/__tests__/alertLogPlugin.test.tsx apps/host-twin/plugins/__tests__/sensorChartPlugin.test.tsx apps/host-twin/plugins/__tests__/sessionRecorderPlugin.test.tsx apps/host-twin/__tests__/PluginInspectorPanel.test.tsx packages/plugin-runtime/src/__tests__/loader.test.ts packages/plugin-runtime/src/__tests__/registry.test.tsx
git commit -m "fix(host-twin,plugin-runtime): add setDemoMode to remaining fake-bindings test helpers"
```

---

### Task 7: Manual verification + update the roadmap doc

**Files:**
- Modify: `docs/superpowers/specs/2026-07-22-plugin-platform-roadmap-v2.md`

- [ ] **Step 1: Manually verify demo mode in a running app**

Run: `pnpm dev` (from repo root)

In the browser:
1. Confirm the WS status badge shows "● 연결됨" (or "○ 연결 중...") if a backend is running, or the disconnected state if not.
2. Find the "데모 컨트롤러" panel and click "데모 모드 시작".
3. Confirm the status badge changes to "🎬 데모 모드" (purple).
4. Confirm sensor data keeps flowing (sine-wave pattern, visible in charts) — this is `useSimulator` auto-activating because `wsStatus` is no longer `"connected"`.
5. Click "데모 모드 종료" and confirm the badge returns to attempting a real connection.

This step has no automated assertion beyond what Tasks 1-6 already test — it's the same kind of manual smoke check used for Phase 4's upload flow, since it exercises the real `useWebSocket` effect timing and `useSimulator`'s auto-fallback together, which no single unit test covers end-to-end.

- [ ] **Step 2: Mark Phase 5a complete in the roadmap doc**

Read `docs/superpowers/specs/2026-07-22-plugin-platform-roadmap-v2.md` first. Find the `## Phase 5 — WebSocket 스트림 모킹 데모 모드 + 플러그인 확장` heading. Since this plan only implements the demo-mode half (5a) and NOT the rule-editor drag extension (5b, separate future brainstorming), do not mark the whole Phase 5 heading `(완료)`. Instead, insert a status note right after the heading, before the existing `**목표:**` paragraph:

```markdown
## Phase 5 — WebSocket 스트림 모킹 데모 모드 + 플러그인 확장

**상태 (5a만 완료):** 두 독립 서브시스템으로 분리해서 진행 중(Phase 3의 분리 전례와 동일한 이유). "WS 스트림 모킹 데모 모드"(5a)는 구현 완료 — 상세 설계는 `2026-07-28-plugin-platform-phase5a-demo-mode-design.md`, 구현 계획은 `2026-07-28-plugin-platform-phase5a-demo-mode-implementation.md` 참조. "룰 에디터 드래그 인터랙션 확장"(5b)은 아직 브레인스토밍 전.

**5a 실제 구현:** 설계 단계에서 `apps/host-twin/hooks/useSimulator.ts`가 이미 WS 미연결 시 자동으로 가동되는 모킹 시뮬레이터(사인파+가우시안 노이즈, 고장 주기 포함)를 구현하고 있음을 발견해, 새 생성기를 만드는 대신 `useWebSocket`에 `demoMode` 파라미터를 추가해 실제 연결을 건너뛰게 하는 방식으로 기존 로직을 재사용했다. `PluginProps`에 최초의 쓰기 메서드(`setDemoMode`)를 추가해 새 `demoControllerPlugin` 패널이 런타임에 토글할 수 있게 했다.
```

Keep the original `**목표:**` and `**의존관계:**` lines below this, unchanged.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-07-22-plugin-platform-roadmap-v2.md
git commit -m "docs: mark Phase 5a (demo mode) complete in roadmap"
```

---

## Final Verification

Run: `pnpm typecheck` (repo root) — Expected: PASS, zero errors.
Run: `pnpm test` (repo root) — Expected: PASS. `@sdf/plugin-runtime` 46, `@sdf/host-twin` 94, `@sdf/backend-sim` 74.
Run: `pnpm build` (repo root) — Expected: PASS, clean production build.
