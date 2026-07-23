# Plugin Platform Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finalize `PluginProps` as a selector-based `useStoreSlice` hook (replacing a dead prop-drilling stub), thread it through `PluginPanel.component` to actual panel renders, and ship two example plugins (a sensor chart, an alert log) that prove the API is sufficient for real dashboard use cases without full-tree re-renders on every 10Hz tick.

**Architecture:** `useStoreSlice` is built with React's `useSyncExternalStore` layered on top of Phase 0's existing whitelisted `PluginContextBindings.getReadOnlyState`/`subscribe` — no changes to those bindings or to `apps/host-twin/lib/pluginBootstrap.ts`'s `createHostBindings()`. A selector result is memoized with `Object.is` so React only re-renders a panel when its selected slice's reference actually changes, even though the underlying store still clones its full state on every change (a separate, deliberately-deferred backlog item). `PluginPanel.component` becomes `(props: PluginProps) => unknown`, and `packages/plugin-runtime`'s `PanelRenderer`/`PluginRegistry.getPanelComponents()` thread a `PluginProps` object through to every rendered panel.

**Tech Stack:** TypeScript, React 18, Zustand, Vitest + `@testing-library/react` (jsdom), ECharts, pnpm workspaces, Turborepo.

**Spec:** `docs/superpowers/specs/2026-07-23-plugin-platform-phase2-design.md`

**Test-environment note:** No existing test in this repo renders an ECharts-backed component (`BaseECharts`/`SensorChart`) — `apps/host-twin`'s jsdom environment has no `canvas` polyfill installed, and `echarts.init()` reading a 2D canvas context in jsdom is untested territory. Task 8's plugin test mocks `BaseECharts` out entirely (`vi.mock`) so it only exercises the plugin's own selection/empty-state logic, not ECharts' jsdom compatibility — that's a pre-existing gap in the codebase, not something this plan introduces or needs to fix.

---

### Task 1: Redefine `PluginProps` and widen `PluginPanel.component`'s signature

This is a direct type edit (like Phase 0's `LayoutPanelId` widening) — no TDD ceremony, verified by `pnpm typecheck` across the whole repo.

**Files:**
- Modify: `packages/types/src/index.ts:298-310`

- [ ] **Step 1: Replace `PluginPanel` and `PluginProps`**

Find:
```typescript
export interface PluginPanel {
  id: string
  label: string
  component: () => unknown
  defaultPosition?: { x: number; y: number; w: number; h: number }
}

export interface PluginProps {
  entityId: string | null
  machines: Record<string, MachineState>
  config: DashboardConfig
  onConfigChange: (patch: Partial<EntityConfig>) => void
}
```

Replace with:
```typescript
export interface PluginPanel {
  id: string
  label: string
  component: (props: PluginProps) => unknown
  defaultPosition?: { x: number; y: number; w: number; h: number }
}

export interface PluginProps {
  /**
   * Subscribes to a slice of the host store via a selector. The component
   * only re-renders when the selected value actually changes (compared with
   * Object.is), not on every host store update. `state` is typed `unknown` —
   * plugin-runtime has no dependency on the host app's concrete store shape,
   * so plugin authors cast to whatever shape they know at the call site.
   */
  useStoreSlice: <T>(selector: (state: unknown) => T) => T
}
```

- [ ] **Step 2: Verify the whole repo still typechecks**

Run (from repo root): `pnpm typecheck`
Expected: FAIL at this point — `apps/host-twin/lib/pluginBootstrap.ts`, `packages/plugin-runtime/src/registry.ts`, and their tests still use the old `component: () => unknown` / zero-arg `getPanelComponents()` shapes. This is expected; those get fixed in Tasks 2-7. Confirm the failures are ONLY in `@sdf/plugin-runtime` and `@sdf/host-twin` (not `@sdf/types`, `@sdf/ui`, `@sdf/core-sdk`, `@sdf/backend-sim`) — that confirms this step's edit itself is syntactically correct and the widening didn't break anything outside the plugin system.

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/index.ts
git commit -m "feat(types): finalize PluginProps as useStoreSlice, widen PluginPanel.component to accept props"
```

---

### Task 2: `createUseStoreSlice()` — selector hook with re-render bypass

**Files:**
- Create: `packages/plugin-runtime/src/useStoreSlice.ts`
- Test: `packages/plugin-runtime/src/__tests__/useStoreSlice.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/plugin-runtime/src/__tests__/useStoreSlice.test.tsx`:

```typescript
import { describe, it, expect } from "vitest"
import { render, screen, act } from "@testing-library/react"
import { createUseStoreSlice } from "../useStoreSlice"

interface FakeState {
  count: number
  other: number
}

function makeFakeStore(initial: FakeState) {
  let state: unknown = initial
  const listeners = new Set<(s: unknown) => void>()
  return {
    getState: () => state,
    subscribe: (listener: (s: unknown) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setState: (patch: Partial<FakeState>) => {
      state = { ...(state as FakeState), ...patch }
      listeners.forEach((l) => l(state))
    },
  }
}

describe("createUseStoreSlice", () => {
  it("returns the selected slice", () => {
    const store = makeFakeStore({ count: 1, other: 10 })
    const useStoreSlice = createUseStoreSlice(store.getState, store.subscribe)

    function TestComponent() {
      const count = useStoreSlice((s) => (s as FakeState).count)
      return <div>{count}</div>
    }

    render(<TestComponent />)
    expect(screen.getByText("1")).toBeInTheDocument()
  })

  it("does not re-render when an unrelated slice changes", () => {
    const store = makeFakeStore({ count: 1, other: 10 })
    const useStoreSlice = createUseStoreSlice(store.getState, store.subscribe)
    let renderCount = 0

    function TestComponent() {
      renderCount++
      const count = useStoreSlice((s) => (s as FakeState).count)
      return <div>{count}</div>
    }

    render(<TestComponent />)
    expect(renderCount).toBe(1)

    act(() => {
      store.setState({ other: 999 })
    })
    expect(renderCount).toBe(1)
  })

  it("re-renders when the selected slice changes", () => {
    const store = makeFakeStore({ count: 1, other: 10 })
    const useStoreSlice = createUseStoreSlice(store.getState, store.subscribe)
    let renderCount = 0

    function TestComponent() {
      renderCount++
      const count = useStoreSlice((s) => (s as FakeState).count)
      return <div>{count}</div>
    }

    render(<TestComponent />)
    expect(renderCount).toBe(1)

    act(() => {
      store.setState({ count: 2 })
    })
    expect(renderCount).toBe(2)
    expect(screen.getByText("2")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sdf/plugin-runtime test`
Expected: FAIL — `Cannot find module '../useStoreSlice'`

- [ ] **Step 3: Write minimal implementation**

Create `packages/plugin-runtime/src/useStoreSlice.ts`:

```typescript
import { useSyncExternalStore, useRef, useCallback } from "react"

export function createUseStoreSlice(
  getState: () => unknown,
  subscribe: (listener: (state: unknown) => void) => () => void,
) {
  return function useStoreSlice<T>(selector: (state: unknown) => T): T {
    const selectorRef = useRef(selector)
    selectorRef.current = selector
    const lastValueRef = useRef<{ value: T } | null>(null)

    const getSnapshot = useCallback(() => {
      const next = selectorRef.current(getState())
      if (lastValueRef.current && Object.is(lastValueRef.current.value, next)) {
        return lastValueRef.current.value
      }
      lastValueRef.current = { value: next }
      return next
    }, [])

    const subscribeToStore = useCallback(
      (onStoreChange: () => void) => subscribe(() => onStoreChange()),
      [],
    )

    return useSyncExternalStore(subscribeToStore, getSnapshot)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sdf/plugin-runtime test`
Expected: PASS (16 tests total — 13 existing + 3 new)

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-runtime/src/useStoreSlice.ts packages/plugin-runtime/src/__tests__/useStoreSlice.test.tsx
git commit -m "feat(plugin-runtime): add createUseStoreSlice with re-render bypass on unrelated store changes"
```

---

### Task 3: `createPluginProps()` in `context.ts`

**Files:**
- Modify: `packages/plugin-runtime/src/context.ts`
- Modify: `packages/plugin-runtime/src/__tests__/context.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/plugin-runtime/src/__tests__/context.test.ts`:

```typescript
import { createElement } from "react"
import { render, screen } from "@testing-library/react"
import { createPluginProps } from "../context"

describe("createPluginProps", () => {
  it("exposes exactly the useStoreSlice key", () => {
    const props = createPluginProps(makeBindings())
    expect(Object.keys(props)).toEqual(["useStoreSlice"])
  })

  it("useStoreSlice reads the selected slice from bindings.getReadOnlyState", () => {
    const bindings = makeBindings()
    bindings.getReadOnlyState = vi.fn(() => ({ machines: { M1: { vibration: 42 } } }))
    const props = createPluginProps(bindings)

    function TestComponent() {
      const vibration = props.useStoreSlice(
        (s) => (s as { machines: { M1: { vibration: number } } }).machines.M1.vibration,
      )
      return createElement("div", null, vibration)
    }

    render(createElement(TestComponent))
    expect(screen.getByText("42")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sdf/plugin-runtime test`
Expected: FAIL — `createPluginProps is not exported from '../context'` (or `Cannot find name 'createPluginProps'`)

- [ ] **Step 3: Write minimal implementation**

In `packages/plugin-runtime/src/context.ts`, change the import line and add the new function at the end of the file:

Find:
```typescript
import type { PluginContext, PluginPanel, Rule, ComputedMetric } from "@sdf/types"
import type { PluginRegistry } from "./registry"
```

Replace with:
```typescript
import type { PluginContext, PluginPanel, PluginProps, Rule, ComputedMetric } from "@sdf/types"
import type { PluginRegistry } from "./registry"
import { createUseStoreSlice } from "./useStoreSlice"
```

Add at the end of the file (after `createPluginContext`'s closing brace):
```typescript

export function createPluginProps(bindings: PluginContextBindings): PluginProps {
  return {
    useStoreSlice: createUseStoreSlice(bindings.getReadOnlyState, bindings.subscribe),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sdf/plugin-runtime test`
Expected: PASS (18 tests total)

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-runtime/src/context.ts packages/plugin-runtime/src/__tests__/context.test.ts
git commit -m "feat(plugin-runtime): add createPluginProps building useStoreSlice from existing bindings"
```

---

### Task 4: Thread `PluginProps` through `PanelRenderer`/`PluginRegistry`

**Files:**
- Modify: `packages/plugin-runtime/src/registry.ts`
- Modify: `packages/plugin-runtime/src/__tests__/registry.test.tsx`

- [ ] **Step 1: Update the existing tests for the new required `props` argument**

In `packages/plugin-runtime/src/__tests__/registry.test.tsx`, find:
```typescript
import { render, screen } from "@testing-library/react"
import { vi } from "vitest"
```

Replace with:
```typescript
import { render, screen } from "@testing-library/react"
import { vi } from "vitest"
import type { PluginProps } from "@sdf/types"

const fakeProps: PluginProps = {
  useStoreSlice: (selector) => selector(undefined),
}
```

Find (inside `describe("PluginRegistry — panel components", ...)`):
```typescript
    registry.registerPanelComponent("demo", () => "hello from plugin")
    const panels = registry.getPanelComponents()
```

Replace with:
```typescript
    registry.registerPanelComponent("demo", () => "hello from plugin")
    const panels = registry.getPanelComponents(fakeProps)
```

Find:
```typescript
    registry.registerPanelComponent("boom", () => {
      throw new Error("plugin exploded")
    })
    const panels = registry.getPanelComponents()
```

Replace with:
```typescript
    registry.registerPanelComponent("boom", () => {
      throw new Error("plugin exploded")
    })
    const panels = registry.getPanelComponents(fakeProps)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sdf/plugin-runtime test`
Expected: FAIL — `Expected 1 arguments, but got 0` (TypeScript) or a runtime mismatch, since `registry.ts` doesn't accept/use `props` yet.

- [ ] **Step 3: Write minimal implementation**

Replace `packages/plugin-runtime/src/registry.ts` with:

```typescript
import { createElement, type ReactNode } from "react"
import { DashboardErrorBoundary } from "@sdf/ui"
import type { SDFPlugin, PluginProps } from "@sdf/types"

function PanelRenderer({
  component,
  props,
}: {
  component: (props: PluginProps) => unknown
  props: PluginProps
}): ReactNode {
  return component(props) as ReactNode
}

export class PluginRegistry {
  private plugins = new Map<string, SDFPlugin>()
  private panelComponents = new Map<string, (props: PluginProps) => unknown>()

  register(plugin: SDFPlugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`[PluginRegistry] plugin id already registered: ${plugin.id}`)
    }
    this.plugins.set(plugin.id, plugin)
  }

  unregister(id: string): void {
    this.plugins.delete(id)
  }

  has(id: string): boolean {
    return this.plugins.has(id)
  }

  registerPanelComponent(id: string, component: (props: PluginProps) => unknown): void {
    if (this.panelComponents.has(id)) {
      throw new Error(`[PluginRegistry] panel id already registered: ${id}`)
    }
    this.panelComponents.set(id, component)
  }

  getPanelComponents(props: PluginProps): Record<string, ReactNode> {
    const result: Record<string, ReactNode> = {}
    for (const [id, component] of this.panelComponents.entries()) {
      result[id] = createElement(DashboardErrorBoundary, {
        label: id,
        children: createElement(PanelRenderer, { component, props }),
      })
    }
    return result
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sdf/plugin-runtime test`
Expected: PASS (18 tests total — same count as Task 3, these were modified not added)

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-runtime/src/registry.ts packages/plugin-runtime/src/__tests__/registry.test.tsx
git commit -m "feat(plugin-runtime): thread PluginProps through PanelRenderer and getPanelComponents"
```

---

### Task 5: Barrel export updates

**Files:**
- Modify: `packages/plugin-runtime/src/index.ts`

- [ ] **Step 1: Add the new exports**

Replace `packages/plugin-runtime/src/index.ts` with:

```typescript
export { PluginRegistry } from "./registry"
export { createPluginContext, createPluginProps, type PluginContextBindings } from "./context"
export { loadPlugins } from "./loader"
export { createUseStoreSlice } from "./useStoreSlice"
```

- [ ] **Step 2: Verify package typecheck and full test suite**

Run: `pnpm --filter @sdf/plugin-runtime typecheck`
Expected: PASS

Run: `pnpm --filter @sdf/plugin-runtime test`
Expected: PASS (18 tests)

- [ ] **Step 3: Commit**

```bash
git add packages/plugin-runtime/src/index.ts
git commit -m "feat(plugin-runtime): export createPluginProps and createUseStoreSlice from index.ts"
```

---

### Task 6: Wire `pluginProps` into `apps/host-twin/lib/pluginBootstrap.ts`

**Files:**
- Modify: `apps/host-twin/lib/pluginBootstrap.ts`
- Modify: `apps/host-twin/__tests__/pluginContextIntegration.test.ts`

- [ ] **Step 1: Update the existing integration test for the new required `props` argument**

In `apps/host-twin/__tests__/pluginContextIntegration.test.ts`, find:
```typescript
import { PluginRegistry, createPluginContext, loadPlugins } from "@sdf/plugin-runtime"
```

Replace with:
```typescript
import { PluginRegistry, createPluginContext, createPluginProps, loadPlugins } from "@sdf/plugin-runtime"
```

Find (at the end of the `"does not add the panel when its id collides with a built-in panel"` test):
```typescript
    expect(registry.getPanelComponents()).not.toHaveProperty("canvas")
```

Replace with:
```typescript
    const props = createPluginProps(createHostBindings())
    expect(registry.getPanelComponents(props)).not.toHaveProperty("canvas")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sdf/host-twin test -- pluginContextIntegration.test.ts`
Expected: FAIL — TypeScript error, `getPanelComponents` expects 1 argument.

- [ ] **Step 3: Write minimal implementation**

In `apps/host-twin/lib/pluginBootstrap.ts`, find:
```typescript
import {
  PluginRegistry,
  createPluginContext,
  loadPlugins,
  type PluginContextBindings,
} from "@sdf/plugin-runtime"
```

Replace with:
```typescript
import {
  PluginRegistry,
  createPluginContext,
  createPluginProps,
  loadPlugins,
  type PluginContextBindings,
} from "@sdf/plugin-runtime"
```

Find:
```typescript
const pluginContext = createPluginContext(pluginRegistry, createHostBindings())
```

Replace with:
```typescript
const hostBindings = createHostBindings()
const pluginContext = createPluginContext(pluginRegistry, hostBindings)
export const pluginProps = createPluginProps(hostBindings)
```

(This reuses the same `hostBindings` instance for both `pluginContext` and `pluginProps` rather than calling `createHostBindings()` twice — both would behave identically since `createHostBindings()`'s returned closures always read from the same live `useFactoryStore`, but reusing one instance avoids constructing two equivalent-but-distinct binding objects.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sdf/host-twin test -- pluginContextIntegration.test.ts`
Expected: PASS (3 tests)

Run: `pnpm --filter @sdf/host-twin test -- pluginBootstrap.test.ts`
Expected: PASS (4 tests — unaffected, these call `createHostBindings()` directly and don't touch `pluginContext`/`pluginProps`)

- [ ] **Step 5: Commit**

```bash
git add apps/host-twin/lib/pluginBootstrap.ts apps/host-twin/__tests__/pluginContextIntegration.test.ts
git commit -m "feat(host-twin): export pluginProps from pluginBootstrap, built from the existing host bindings"
```

---

### Task 7: Pass `pluginProps` to `getPanelComponents()` in `page.tsx`

**Files:**
- Modify: `apps/host-twin/app/page.tsx`

- [ ] **Step 1: Update the import and the call site**

Find:
```typescript
import { bootstrapPlugins, pluginRegistry } from "@/lib/pluginBootstrap"
```

Replace with:
```typescript
import { bootstrapPlugins, pluginRegistry, pluginProps } from "@/lib/pluginBootstrap"
```

Find:
```typescript
    ...pluginRegistry.getPanelComponents(),
  }
```

Replace with:
```typescript
    ...pluginRegistry.getPanelComponents(pluginProps),
  }
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @sdf/host-twin typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/host-twin/app/page.tsx
git commit -m "feat(host-twin): pass pluginProps into panel rendering"
```

---

### Task 8: `sensorChartPlugin` — example visualization plugin

**Files:**
- Create: `apps/host-twin/plugins/sensorChartPlugin.tsx`
- Test: `apps/host-twin/plugins/__tests__/sensorChartPlugin.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/host-twin/plugins/__tests__/sensorChartPlugin.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { createPluginProps } from "@sdf/plugin-runtime"
import { SensorChartPanel } from "../sensorChartPlugin"

vi.mock("@/components/BaseECharts", () => ({
  BaseECharts: () => <div data-testid="chart-mock" />,
}))

function makeFakeBindings(initial: unknown) {
  let state = initial
  const listeners = new Set<(s: unknown) => void>()
  return {
    getReadOnlyState: () => state,
    subscribe: (listener: (s: unknown) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    addRule: () => {},
    addComputedMetric: () => {},
    registerPanelPosition: () => {},
  }
}

describe("SensorChartPanel", () => {
  it("renders an empty state when M1 has no history yet", () => {
    const props = createPluginProps(makeFakeBindings({ machines: { M1: { history: [] } } }))
    render(<SensorChartPanel {...props} />)
    expect(screen.getByText(/데이터 대기 중/)).toBeInTheDocument()
    expect(screen.queryByTestId("chart-mock")).not.toBeInTheDocument()
  })

  it("renders the chart once M1's history is populated", () => {
    const props = createPluginProps(
      makeFakeBindings({ machines: { M1: { history: [[1000, 50, 60, 10]] } } }),
    )
    render(<SensorChartPanel {...props} />)
    expect(screen.queryByText(/데이터 대기 중/)).not.toBeInTheDocument()
    expect(screen.getByTestId("chart-mock")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sdf/host-twin test -- sensorChartPlugin.test.tsx`
Expected: FAIL — `Cannot find module '../sensorChartPlugin'`

- [ ] **Step 3: Write minimal implementation**

Create `apps/host-twin/plugins/sensorChartPlugin.tsx`:

```typescript
"use client"
import type { PluginProps, SDFPlugin } from "@sdf/types"
import type * as echarts from "echarts"
import { BaseECharts } from "@/components/BaseECharts"

const MACHINE_ID = "M1"

interface FactoryStoreShape {
  machines: Record<string, { history: [number, number, number, number][] }>
}

export function SensorChartPanel(props: PluginProps) {
  const history = props.useStoreSlice(
    (s) => (s as FactoryStoreShape).machines[MACHINE_ID]?.history,
  )

  if (!history || history.length === 0) {
    return (
      <div className="bg-gray-900 rounded-lg p-4 text-xs text-gray-600 text-center">
        {MACHINE_ID} 데이터 대기 중...
      </div>
    )
  }

  const option: echarts.EChartsOption = {
    backgroundColor: "transparent",
    animation: false,
    grid: { left: 36, right: 10, top: 18, bottom: 18 },
    xAxis: {
      type: "time",
      splitLine: { show: false },
      axisLabel: { fontSize: 9, color: "#6b7280" },
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: "#1f2937" } },
      axisLabel: { fontSize: 9, color: "#6b7280" },
    },
    series: [
      {
        name: "진동(Hz)",
        type: "line",
        data: history.map((row) => [row[0], row[1]]),
        smooth: true,
        symbol: "none",
        lineStyle: { color: "#3b82f6", width: 1.5 },
      },
      {
        name: "온도(°C)",
        type: "line",
        data: history.map((row) => [row[0], row[2]]),
        smooth: true,
        symbol: "none",
        lineStyle: { color: "#f59e0b", width: 1.5 },
      },
      {
        name: "전류(A)",
        type: "line",
        data: history.map((row) => [row[0], row[3]]),
        smooth: true,
        symbol: "none",
        lineStyle: { color: "#10b981", width: 1.5 },
      },
    ],
  }

  return (
    <div className="bg-gray-900 rounded-lg p-2">
      <p className="text-xs text-gray-400 mb-1">예시 플러그인: {MACHINE_ID} 센서 차트</p>
      <BaseECharts option={option} notMerge={false} />
    </div>
  )
}

export const sensorChartPlugin: SDFPlugin = {
  id: "example-sensor-chart",
  name: "Example: Sensor Chart",
  version: "0.1.0",
  activate: (ctx) => {
    ctx.registerPanel({
      id: "example-sensor-chart-panel",
      label: "예시: 센서 차트 (M1)",
      component: (props) => <SensorChartPanel {...props} />,
    })
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sdf/host-twin test -- sensorChartPlugin.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/host-twin/plugins/sensorChartPlugin.tsx apps/host-twin/plugins/__tests__/sensorChartPlugin.test.tsx
git commit -m "feat(host-twin): add example sensor chart plugin using useStoreSlice"
```

---

### Task 9: `alertLogPlugin` — example visualization plugin

**Files:**
- Create: `apps/host-twin/plugins/alertLogPlugin.tsx`
- Test: `apps/host-twin/plugins/__tests__/alertLogPlugin.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/host-twin/plugins/__tests__/alertLogPlugin.test.tsx`:

```typescript
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { createPluginProps } from "@sdf/plugin-runtime"
import { AlertLogPanel } from "../alertLogPlugin"

function makeFakeBindings(initial: unknown) {
  let state = initial
  const listeners = new Set<(s: unknown) => void>()
  return {
    getReadOnlyState: () => state,
    subscribe: (listener: (s: unknown) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    addRule: () => {},
    addComputedMetric: () => {},
    registerPanelPosition: () => {},
  }
}

describe("AlertLogPanel", () => {
  it("renders an empty state when there is no alert history", () => {
    const props = createPluginProps(makeFakeBindings({ alertHistory: [] }))
    render(<AlertLogPanel {...props} />)
    expect(screen.getByText("알림 없음")).toBeInTheDocument()
  })

  it("renders alert items once alertHistory is populated", () => {
    const props = createPluginProps(
      makeFakeBindings({
        alertHistory: [{ id: "a1", machineId: "M1", ts: Date.UTC(2026, 0, 1, 12, 0, 0) }],
      }),
    )
    render(<AlertLogPanel {...props} />)
    expect(screen.queryByText("알림 없음")).not.toBeInTheDocument()
    expect(screen.getByText("M1")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sdf/host-twin test -- alertLogPlugin.test.tsx`
Expected: FAIL — `Cannot find module '../alertLogPlugin'`

- [ ] **Step 3: Write minimal implementation**

Create `apps/host-twin/plugins/alertLogPlugin.tsx`:

```typescript
"use client"
import type { PluginProps, SDFPlugin } from "@sdf/types"

interface AlertHistoryItemShape {
  id: string
  machineId: string
  ts: number
  result?: string
}

interface FactoryStoreShape {
  alertHistory: AlertHistoryItemShape[]
}

export function AlertLogPanel(props: PluginProps) {
  const alertHistory = props.useStoreSlice((s) => (s as FactoryStoreShape).alertHistory)

  if (!alertHistory || alertHistory.length === 0) {
    return (
      <div className="bg-gray-900 rounded-lg p-4 text-xs text-gray-600 text-center">
        알림 없음
      </div>
    )
  }

  return (
    <div className="bg-gray-900 rounded-lg p-3 space-y-1">
      <p className="text-xs text-gray-400 mb-1">예시 플러그인: 위험 알림 로그</p>
      {alertHistory.map((item) => (
        <div key={item.id} className="flex items-center gap-2 text-xs">
          <span className="text-yellow-500">⚠</span>
          <span className="text-gray-200">{item.machineId}</span>
          <span className="text-gray-600 ml-auto tabular-nums">
            {new Date(item.ts).toLocaleTimeString("ko-KR", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
        </div>
      ))}
    </div>
  )
}

export const alertLogPlugin: SDFPlugin = {
  id: "example-alert-log",
  name: "Example: Alert Log",
  version: "0.1.0",
  activate: (ctx) => {
    ctx.registerPanel({
      id: "example-alert-log-panel",
      label: "예시: 위험 알림 로그",
      component: (props) => <AlertLogPanel {...props} />,
    })
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sdf/host-twin test -- alertLogPlugin.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/host-twin/plugins/alertLogPlugin.tsx apps/host-twin/plugins/__tests__/alertLogPlugin.test.tsx
git commit -m "feat(host-twin): add example alert log plugin using useStoreSlice"
```

---

### Task 10: Install both example plugins

**Files:**
- Modify: `apps/host-twin/lib/plugins.ts`

- [ ] **Step 1: Add both plugins to `installedPlugins`**

Replace `apps/host-twin/lib/plugins.ts` with:

```typescript
import type { SDFPlugin } from "@sdf/types"
import { sensorChartPlugin } from "@/plugins/sensorChartPlugin"
import { alertLogPlugin } from "@/plugins/alertLogPlugin"

/**
 * Statically installed plugins. Add imported plugin objects to this array
 * to activate them at app boot. (Phase 4 will add a dynamic loader that
 * calls the same PluginRegistry.register() entry point at runtime.)
 */
export const installedPlugins: SDFPlugin[] = [sensorChartPlugin, alertLogPlugin]
```

- [ ] **Step 2: Verify typecheck, full host-twin test suite, and a manual smoke check**

Run: `pnpm --filter @sdf/host-twin typecheck`
Expected: PASS

Run: `pnpm --filter @sdf/host-twin test`
Expected: PASS — all existing tests plus the two new plugin test files, all green.

Run: `pnpm --filter @sdf/host-twin dev`

Open `http://localhost:3000`. Expected: the "charts" panel area now also shows two new panels appended below existing content — "예시: 센서 차트 (M1)" and "예시: 위험 알림 로그" — updating live as the simulator ticks, without the rest of the dashboard (3D canvas, agent panel) flickering or re-rendering because of them. Check the browser console for errors.

Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add apps/host-twin/lib/plugins.ts
git commit -m "feat(host-twin): install the two example plugins"
```

---

### Task 11: Full-repo verification

**Files:** none (verification only)

- [ ] **Step 1: Install, typecheck, test, build across the whole monorepo**

Run: `pnpm install`
Expected: no errors

Run: `pnpm typecheck`
Expected: PASS for every package

Run: `pnpm --filter '!@sdf/backend-sim' test`
Expected: PASS — all frontend packages green. (`@sdf/backend-sim`'s `test` script invokes `uv run pytest`, which is broken in this environment per prior phases' notes — verify the backend separately: `cd apps/backend-sim && .venv/Scripts/python.exe -m pytest -q`, expect the same pass count as before this plan, since Phase 2 touches no backend files.)

Run: `pnpm build`
Expected: PASS

- [ ] **Step 2: If any step fails, fix before proceeding**

Do not proceed to Task 12 until all commands pass cleanly.

---

### Task 12: Changeset

**Files:**
- Create: `.changeset/<generated-name>.md` (via CLI, not hand-written)

- [ ] **Step 1: Generate the changeset**

Run: `pnpm changeset`

When prompted:
- Select `@sdf/plugin-runtime` as changed (minor — `useStoreSlice`/`createPluginProps` are new public API; `PluginPanel.component`'s signature change is breaking but the package is still `0.x`)
- Select `@sdf/types` as changed (patch — `PluginProps`/`PluginPanel` type changes)
- Summary: `Finalize PluginProps as a useStoreSlice selector hook (Render-Bypass for 10Hz store updates), thread it through PluginPanel.component, and ship two example plugins.`

- [ ] **Step 2: Commit the changeset**

```bash
git add .changeset
git commit -m "chore: add changeset for Phase 2 plugin-runtime/types changes"
```

---

## Self-Review Notes

- **Spec coverage:** §2.1 `PluginProps` redefinition → Task 1. §2.2 `useStoreSlice` implementation + `createPluginProps` → Tasks 2-3. §2.3 `PluginPanel.component` signature + `PanelRenderer` → Tasks 1, 4, and the host-side call sites (Tasks 6-7). §2.4 example plugins → Tasks 8-10. §3 data flow → validated end-to-end by Task 10's manual smoke check. §4 error handling → covered by Phase 0's existing `DashboardErrorBoundary` wrapping (unchanged, `getPanelComponents` still wraps every panel) — no new task needed since no new error-handling code is introduced. §5 test plan → Tasks 2 (re-render bypass), 3 (props wiring), 4 (signature/props threading), 8-9 (empty/populated panel states). §6 release → Task 12. §7 file impact list → matches Tasks 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 exactly; the "not changed" files (`SensorChart.tsx`, `AlertHistory.tsx`, `factoryStore.ts`, `loader.ts`, `PluginContext`/`PluginContextBindings`) are confirmed absent from every task's file list.
- **Type consistency verified:** `PluginProps.useStoreSlice` signature (`<T>(selector: (state: unknown) => T) => T`) matches exactly between `packages/types/src/index.ts` (Task 1), `createUseStoreSlice`'s return type (Task 2), and every test/plugin call site (Tasks 3, 8, 9). `PluginContextBindings` (unchanged from Phase 0: `getReadOnlyState`, `subscribe`, `addRule`, `addComputedMetric`, `registerPanelPosition`) is the exact input type to both `createPluginContext` and `createPluginProps` (Task 3), and the fake bindings objects in Tasks 8-9's tests match its shape. `getPanelComponents(props: PluginProps)` signature is consistent across `registry.ts` (Task 4), `pluginContextIntegration.test.ts` (Task 6), and `page.tsx` (Task 7).
- **No placeholders:** every step has complete, exact code. The ECharts/jsdom test-environment risk is called out explicitly at the top of the plan with a concrete mitigation (`vi.mock` in Task 8), not left as an unstated assumption.
