# Plugin Platform Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up the currently-unused `SDFPlugin`/`PluginContext`/`PluginPanel` contracts in `@sdf/types` into a real, working plugin registry that lets a statically-registered plugin add a dashboard panel, a rule, and a computed metric to the running SDF Digital Twin app.

**Architecture:** A new host-agnostic `@sdf/plugin-runtime` package provides `PluginRegistry` (tracks plugins + panel components, auto-wraps panels in `DashboardErrorBoundary`), `createPluginContext()` (builds a whitelisted `PluginContext` from host-supplied bindings — no direct dependency on `apps/host-twin`), and `loadPlugins()` (static activation loop with per-plugin error containment). `apps/host-twin` wires this to its Zustand store via a small bindings object and merges plugin panels into the existing `LayoutGrid` panel map without touching the 6 built-in panels' rendering paths.

**Tech Stack:** TypeScript, React 18, Zustand, Vitest + @testing-library/react (jsdom), pnpm workspaces, Turborepo.

**Spec:** `docs/superpowers/specs/2026-07-22-plugin-platform-phase0-design.md`

---

### Task 1: Scaffold the `packages/plugin-runtime` workspace package

**Files:**
- Create: `packages/plugin-runtime/package.json`
- Create: `packages/plugin-runtime/tsconfig.json`
- Create: `packages/plugin-runtime/vitest.config.ts`
- Create: `packages/plugin-runtime/vitest.setup.ts`
- Create: `packages/plugin-runtime/src/index.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@sdf/plugin-runtime",
  "version": "0.1.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@sdf/types": "workspace:*",
    "@sdf/ui": "workspace:*"
  },
  "peerDependencies": {
    "react": "^18 || ^19",
    "react-dom": "^18 || ^19"
  },
  "devDependencies": {
    "@testing-library/dom": "^10.4.1",
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.2",
    "@types/react": "^18",
    "@types/react-dom": "^18",
    "@vitejs/plugin-react": "^6.0.3",
    "jsdom": "^29.1.1",
    "react": "^18",
    "react-dom": "^18",
    "typescript": "^5.7.0",
    "vitest": "^4.1.7"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "declaration": true,
    "declarationMap": true,
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
  },
})
```

- [ ] **Step 4: Create `vitest.setup.ts`**

```typescript
import "@testing-library/jest-dom/vitest"
```

- [ ] **Step 5: Create an empty `src/index.ts` placeholder**

```typescript
export {}
```

- [ ] **Step 6: Install and verify the workspace picks up the new package**

Run: `pnpm install`
Expected: completes without error. `pnpm-workspace.yaml`'s `packages/*` glob already covers this package, so no config change is needed there.

Run: `pnpm --filter @sdf/plugin-runtime typecheck`
Expected: passes (empty `export {}` has nothing to check).

- [ ] **Step 7: Commit**

```bash
git add packages/plugin-runtime
git commit -m "chore(plugin-runtime): scaffold @sdf/plugin-runtime package"
```

---

### Task 2: `PluginRegistry` — plugin registration with duplicate-id rejection

**Files:**
- Create: `packages/plugin-runtime/src/registry.ts`
- Test: `packages/plugin-runtime/src/__tests__/registry.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/plugin-runtime/src/__tests__/registry.test.tsx`:

```typescript
import { describe, it, expect } from "vitest"
import { PluginRegistry } from "../registry"
import type { SDFPlugin } from "@sdf/types"

function makePlugin(id: string): SDFPlugin {
  return { id, name: id, version: "0.1.0", activate: () => {} }
}

describe("PluginRegistry — plugin registration", () => {
  it("registers a plugin and reports it as present", () => {
    const registry = new PluginRegistry()
    registry.register(makePlugin("demo"))
    expect(registry.has("demo")).toBe(true)
  })

  it("throws when registering a duplicate plugin id", () => {
    const registry = new PluginRegistry()
    registry.register(makePlugin("demo"))
    expect(() => registry.register(makePlugin("demo"))).toThrow(
      /plugin id already registered/,
    )
  })

  it("removes a plugin on unregister", () => {
    const registry = new PluginRegistry()
    registry.register(makePlugin("demo"))
    registry.unregister("demo")
    expect(registry.has("demo")).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sdf/plugin-runtime test`
Expected: FAIL — `Cannot find module '../registry'` (file doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `packages/plugin-runtime/src/registry.ts`:

```typescript
import type { SDFPlugin } from "@sdf/types"

export class PluginRegistry {
  private plugins = new Map<string, SDFPlugin>()

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
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sdf/plugin-runtime test`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-runtime/src/registry.ts packages/plugin-runtime/src/__tests__/registry.test.tsx
git commit -m "feat(plugin-runtime): add PluginRegistry with duplicate-id rejection"
```

---

### Task 3: `PluginRegistry` — panel components with automatic error isolation

**Why a wrapper component matters:** `DashboardErrorBoundary` only catches errors thrown during React's render phase. If a plugin's `component()` factory is called eagerly and its result is wrapped afterward, a throw inside `component()` happens *before* the boundary exists and is not caught. The fix is a small `PanelRenderer` component that calls `component()` **during its own render**, so the throw happens inside the boundary's subtree.

**Files:**
- Modify: `packages/plugin-runtime/src/registry.ts`
- Modify: `packages/plugin-runtime/src/__tests__/registry.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `packages/plugin-runtime/src/__tests__/registry.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react"
import { vi } from "vitest"

describe("PluginRegistry — panel components", () => {
  it("registers a panel component and returns it wrapped for rendering", () => {
    const registry = new PluginRegistry()
    registry.registerPanelComponent("demo", () => "hello from plugin")
    const panels = registry.getPanelComponents()
    render(<div>{panels["demo"]}</div>)
    expect(screen.getByText("hello from plugin")).toBeInTheDocument()
  })

  it("isolates a panel component that throws instead of crashing the tree", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const registry = new PluginRegistry()
    registry.registerPanelComponent("boom", () => {
      throw new Error("plugin exploded")
    })
    const panels = registry.getPanelComponents()
    render(
      <div>
        <div>sibling content</div>
        {panels["boom"]}
      </div>,
    )
    expect(screen.getByText("sibling content")).toBeInTheDocument()
    expect(screen.getByText(/plugin exploded/)).toBeInTheDocument()
  })

  it("rejects registering a duplicate panel id", () => {
    const registry = new PluginRegistry()
    registry.registerPanelComponent("demo", () => "first")
    expect(() => registry.registerPanelComponent("demo", () => "second")).toThrow(
      /panel id already registered/,
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sdf/plugin-runtime test`
Expected: FAIL — `registry.registerPanelComponent is not a function`

- [ ] **Step 3: Write minimal implementation**

Replace `packages/plugin-runtime/src/registry.ts` with:

```typescript
import { createElement, type ReactNode } from "react"
import { DashboardErrorBoundary } from "@sdf/ui"
import type { SDFPlugin } from "@sdf/types"

function PanelRenderer({ component }: { component: () => unknown }): ReactNode {
  return component() as ReactNode
}

export class PluginRegistry {
  private plugins = new Map<string, SDFPlugin>()
  private panelComponents = new Map<string, () => unknown>()

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

  registerPanelComponent(id: string, component: () => unknown): void {
    if (this.panelComponents.has(id)) {
      throw new Error(`[PluginRegistry] panel id already registered: ${id}`)
    }
    this.panelComponents.set(id, component)
  }

  getPanelComponents(): Record<string, ReactNode> {
    const result: Record<string, ReactNode> = {}
    for (const [id, component] of this.panelComponents.entries()) {
      result[id] = createElement(
        DashboardErrorBoundary,
        { label: id },
        createElement(PanelRenderer, { component }),
      )
    }
    return result
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sdf/plugin-runtime test`
Expected: PASS (6 tests total)

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-runtime/src/registry.ts packages/plugin-runtime/src/__tests__/registry.test.tsx
git commit -m "feat(plugin-runtime): auto-wrap plugin panels in DashboardErrorBoundary"
```

---

### Task 4: `createPluginContext()` — whitelisted context

**Files:**
- Create: `packages/plugin-runtime/src/context.ts`
- Test: `packages/plugin-runtime/src/__tests__/context.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/plugin-runtime/src/__tests__/context.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest"
import { PluginRegistry } from "../registry"
import { createPluginContext } from "../context"

function makeBindings() {
  return {
    getReadOnlyState: vi.fn(() => ({ machines: {} })),
    subscribe: vi.fn(() => () => {}),
    addRule: vi.fn(),
    addComputedMetric: vi.fn(),
    registerPanelPosition: vi.fn(),
  }
}

describe("createPluginContext", () => {
  it("exposes exactly the whitelisted keys", () => {
    const ctx = createPluginContext(new PluginRegistry(), makeBindings())
    expect(Object.keys(ctx).sort()).toEqual(
      ["registerMetric", "registerPanel", "registerRule", "store"].sort(),
    )
    expect(Object.keys(ctx.store).sort()).toEqual(["getState", "subscribe"].sort())
  })

  it("registerRule delegates to bindings.addRule", () => {
    const bindings = makeBindings()
    const ctx = createPluginContext(new PluginRegistry(), bindings)
    const rule = { name: "hot", condition: "temperature > 90", machineId: null, actions: [], cooldownMs: 1000, enabled: true }
    ctx.registerRule(rule)
    expect(bindings.addRule).toHaveBeenCalledWith(rule)
  })

  it("registerMetric delegates to bindings.addComputedMetric", () => {
    const bindings = makeBindings()
    const ctx = createPluginContext(new PluginRegistry(), bindings)
    const metric = { name: "sum", formula: "vibration + current", color: "#fff", machineId: null }
    ctx.registerMetric(metric)
    expect(bindings.addComputedMetric).toHaveBeenCalledWith(metric)
  })

  it("registerPanel registers the component in the registry and calls registerPanelPosition", () => {
    const bindings = makeBindings()
    const registry = new PluginRegistry()
    const ctx = createPluginContext(registry, bindings)
    ctx.registerPanel({ id: "p1", label: "Panel 1", component: () => "hi" })
    expect(registry.has).toBeDefined()
    expect(bindings.registerPanelPosition).toHaveBeenCalledWith("p1", "Panel 1", undefined)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sdf/plugin-runtime test`
Expected: FAIL — `Cannot find module '../context'`

- [ ] **Step 3: Write minimal implementation**

Create `packages/plugin-runtime/src/context.ts`:

```typescript
import type { PluginContext, PluginPanel, Rule, ComputedMetric } from "@sdf/types"
import type { PluginRegistry } from "./registry"

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
}

export function createPluginContext(
  registry: PluginRegistry,
  bindings: PluginContextBindings,
): PluginContext {
  return {
    store: {
      getState: bindings.getReadOnlyState,
      subscribe: bindings.subscribe,
    },
    registerPanel: (panel: PluginPanel) => {
      registry.registerPanelComponent(panel.id, panel.component)
      bindings.registerPanelPosition(panel.id, panel.label, panel.defaultPosition)
    },
    registerRule: (rule) => bindings.addRule(rule),
    registerMetric: (metric) => bindings.addComputedMetric(metric),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sdf/plugin-runtime test`
Expected: PASS (10 tests total)

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-runtime/src/context.ts packages/plugin-runtime/src/__tests__/context.test.ts
git commit -m "feat(plugin-runtime): add createPluginContext with whitelisted API"
```

---

### Task 5: `loadPlugins()` — static activation loop with per-plugin error containment

**Files:**
- Create: `packages/plugin-runtime/src/loader.ts`
- Test: `packages/plugin-runtime/src/__tests__/loader.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/plugin-runtime/src/__tests__/loader.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest"
import { PluginRegistry } from "../registry"
import { createPluginContext } from "../context"
import { loadPlugins } from "../loader"
import type { SDFPlugin } from "@sdf/types"

function makeBindings() {
  return {
    getReadOnlyState: () => ({}),
    subscribe: () => () => {},
    addRule: vi.fn(),
    addComputedMetric: vi.fn(),
    registerPanelPosition: vi.fn(),
  }
}

describe("loadPlugins", () => {
  it("activates every plugin in order", () => {
    const registry = new PluginRegistry()
    const ctx = createPluginContext(registry, makeBindings())
    const calls: string[] = []
    const plugins: SDFPlugin[] = [
      { id: "a", name: "A", version: "0.1.0", activate: () => { calls.push("a") } },
      { id: "b", name: "B", version: "0.1.0", activate: () => { calls.push("b") } },
    ]
    loadPlugins(registry, plugins, ctx)
    expect(calls).toEqual(["a", "b"])
  })

  it("logs and continues when a plugin's activate() throws synchronously", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const registry = new PluginRegistry()
    const ctx = createPluginContext(registry, makeBindings())
    const calls: string[] = []
    const plugins: SDFPlugin[] = [
      { id: "bad", name: "Bad", version: "0.1.0", activate: () => { throw new Error("boom") } },
      { id: "good", name: "Good", version: "0.1.0", activate: () => { calls.push("good") } },
    ]
    loadPlugins(registry, plugins, ctx)
    expect(calls).toEqual(["good"])
    expect(errorSpy).toHaveBeenCalled()
  })

  it("logs when a plugin's activate() returns a rejected promise", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const registry = new PluginRegistry()
    const ctx = createPluginContext(registry, makeBindings())
    const plugins: SDFPlugin[] = [
      { id: "async-bad", name: "AsyncBad", version: "0.1.0", activate: async () => { throw new Error("async boom") } },
    ]
    loadPlugins(registry, plugins, ctx)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(errorSpy).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sdf/plugin-runtime test`
Expected: FAIL — `Cannot find module '../loader'`

- [ ] **Step 3: Write minimal implementation**

Create `packages/plugin-runtime/src/loader.ts`:

```typescript
import type { SDFPlugin, PluginContext } from "@sdf/types"
import type { PluginRegistry } from "./registry"

export function loadPlugins(
  registry: PluginRegistry,
  plugins: SDFPlugin[],
  ctx: PluginContext,
): void {
  for (const plugin of plugins) {
    try {
      registry.register(plugin)
      const result = plugin.activate(ctx)
      if (result instanceof Promise) {
        result.catch((err) => {
          console.error(`[loadPlugins] plugin "${plugin.id}" activate() rejected`, err)
        })
      }
    } catch (err) {
      console.error(`[loadPlugins] failed to activate plugin "${plugin.id}"`, err)
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sdf/plugin-runtime test`
Expected: PASS (13 tests total)

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-runtime/src/loader.ts packages/plugin-runtime/src/__tests__/loader.test.ts
git commit -m "feat(plugin-runtime): add loadPlugins with per-plugin error containment"
```

---

### Task 6: Barrel export and package typecheck

**Files:**
- Modify: `packages/plugin-runtime/src/index.ts`

- [ ] **Step 1: Replace the placeholder barrel file**

```typescript
export { PluginRegistry } from "./registry"
export { createPluginContext, type PluginContextBindings } from "./context"
export { loadPlugins } from "./loader"
```

- [ ] **Step 2: Verify typecheck and full package test suite**

Run: `pnpm --filter @sdf/plugin-runtime typecheck`
Expected: PASS, no errors

Run: `pnpm --filter @sdf/plugin-runtime test`
Expected: PASS (13 tests)

- [ ] **Step 3: Commit**

```bash
git add packages/plugin-runtime/src/index.ts
git commit -m "feat(plugin-runtime): export public API from index.ts"
```

---

### Task 7: Fix stale plugin types in `@sdf/types`

`LayoutPanelId` is currently a closed union (`"canvas"|"charts"|"agent"|"detail"|"rules"|"mes"`), which blocks plugin panel ids. `PluginPanel.defaultPosition` still uses the old `{ col, row }` CSS-grid-span shape from the v1 layout system — the app has been on the integer-coordinate v2 model since `LayoutConfig.version` was bumped to `2` (see `docs/ARCHITECTURE.md` §9.2), so this field has been unusable dead shape until now.

**Files:**
- Modify: `packages/types/src/index.ts:199` (`LayoutPanelId`)
- Modify: `packages/types/src/index.ts:298-303` (`PluginPanel`)

- [ ] **Step 1: Widen `LayoutPanelId`**

Find:
```typescript
export type LayoutPanelId = "canvas" | "charts" | "agent" | "detail" | "rules" | "mes"
```

Replace with:
```typescript
export type LayoutPanelId = string
```

- [ ] **Step 2: Fix `PluginPanel.defaultPosition` to match the v2 layout model**

Find:
```typescript
export interface PluginPanel {
  id: string
  label: string
  component: () => unknown
  defaultPosition?: { col: string; row: string }
}
```

Replace with:
```typescript
export interface PluginPanel {
  id: string
  label: string
  component: () => unknown
  defaultPosition?: { x: number; y: number; w: number; h: number }
}
```

- [ ] **Step 3: Verify the whole repo still typechecks**

Run: `pnpm typecheck`
Expected: PASS across all packages/apps — `LayoutPanelId` widening is backward-compatible (every existing literal usage remains a valid `string`), and `PluginPanel.defaultPosition` was not referenced anywhere yet (confirmed by `grep -rn "PluginPanel\|SDFPlugin\|PluginContext" apps/` returning no matches before this plan).

- [ ] **Step 4: Commit**

```bash
git add packages/types/src/index.ts
git commit -m "fix(types): widen LayoutPanelId and fix PluginPanel.defaultPosition to v2 layout shape"
```

---

### Task 8: `factoryStore.ts` — `registerPluginPanel` action

**Files:**
- Modify: `apps/host-twin/store/factoryStore.ts`
- Test: `apps/host-twin/__tests__/factoryStore.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/host-twin/__tests__/factoryStore.test.ts`:

```typescript
describe("registerPluginPanel", () => {
  beforeEach(() => {
    useFactoryStore.setState({
      layoutConfig: {
        version: 2,
        columns: 3,
        panels: [
          { id: "canvas", label: "3D 캔버스", x: 0, y: 0, w: 2, h: 4, visible: true },
        ],
      },
    })
  })

  it("appends a new panel below existing panels when no defaultPosition is given", () => {
    useFactoryStore.getState().registerPluginPanel("demo-panel", "데모 패널")
    const panels = useFactoryStore.getState().layoutConfig.panels
    const panel = panels.find((p) => p.id === "demo-panel")
    expect(panel).toEqual({ id: "demo-panel", label: "데모 패널", x: 0, y: 4, w: 1, h: 3, visible: true })
  })

  it("uses the given defaultPosition when provided", () => {
    useFactoryStore.getState().registerPluginPanel("demo-panel", "데모 패널", { x: 1, y: 0, w: 2, h: 2 })
    const panel = useFactoryStore.getState().layoutConfig.panels.find((p) => p.id === "demo-panel")
    expect(panel).toEqual({ id: "demo-panel", label: "데모 패널", x: 1, y: 0, w: 2, h: 2, visible: true })
  })

  it("is idempotent — registering the same id twice does not duplicate the panel", () => {
    useFactoryStore.getState().registerPluginPanel("demo-panel", "데모 패널")
    useFactoryStore.getState().registerPluginPanel("demo-panel", "데모 패널")
    const matches = useFactoryStore.getState().layoutConfig.panels.filter((p) => p.id === "demo-panel")
    expect(matches).toHaveLength(1)
  })

  it("throws when the id collides with a built-in panel", () => {
    expect(() => useFactoryStore.getState().registerPluginPanel("canvas", "충돌")).toThrow(
      /내장 패널 id와 충돌/,
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sdf/host-twin test -- factoryStore.test.ts`
Expected: FAIL — `useFactoryStore.getState().registerPluginPanel is not a function`

- [ ] **Step 3: Add the constant and action**

In `apps/host-twin/store/factoryStore.ts`, add near `DEFAULT_LAYOUT` (after its closing `}`):

```typescript
const BUILT_IN_PANEL_IDS = new Set(["canvas", "charts", "agent", "detail", "rules", "mes"])
```

In the `FactoryStore` interface, add to the "3단계: 자유 레이아웃 매니저" section (after `setLayoutColumns`):

```typescript
  registerPluginPanel: (
    id: string,
    label: string,
    defaultPosition?: { x: number; y: number; w: number; h: number },
  ) => void
```

In the store implementation, add after `setLayoutColumns`:

```typescript
  registerPluginPanel: (id, label, defaultPosition) => {
    if (BUILT_IN_PANEL_IDS.has(id)) {
      throw new Error(`[registerPluginPanel] "${id}"는 내장 패널 id와 충돌합니다`)
    }
    set((state) => {
      if (state.layoutConfig.panels.some((p) => p.id === id)) return {}
      const nextY = state.layoutConfig.panels.length
        ? Math.max(...state.layoutConfig.panels.map((p) => p.y + p.h))
        : 0
      const panel: LayoutPanel = defaultPosition
        ? { id, label, ...defaultPosition, visible: true }
        : { id, label, x: 0, y: nextY, w: 1, h: 3, visible: true }
      return {
        layoutConfig: {
          ...state.layoutConfig,
          panels: [...state.layoutConfig.panels, panel],
        },
      }
    })
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sdf/host-twin test -- factoryStore.test.ts`
Expected: PASS (all factoryStore tests, including the 4 new ones)

- [ ] **Step 5: Commit**

```bash
git add apps/host-twin/store/factoryStore.ts apps/host-twin/__tests__/factoryStore.test.ts
git commit -m "feat(host-twin): add registerPluginPanel store action"
```

---

### Task 9: Host bindings and static plugin bootstrap

**Files:**
- Modify: `apps/host-twin/package.json` (add `@sdf/plugin-runtime` dependency)
- Create: `apps/host-twin/lib/plugins.ts`
- Create: `apps/host-twin/lib/pluginBootstrap.ts`

- [ ] **Step 1: Add the workspace dependency**

In `apps/host-twin/package.json`, add to `"dependencies"` (alphabetical, after `@sdf/core-sdk`):

```json
    "@sdf/plugin-runtime": "workspace:*",
```

Run: `pnpm install`
Expected: completes without error, links the new workspace dependency.

- [ ] **Step 2: Create the plugin install list**

Create `apps/host-twin/lib/plugins.ts`:

```typescript
import type { SDFPlugin } from "@sdf/types"

/**
 * Statically installed plugins. Add imported plugin objects to this array
 * to activate them at app boot. (Phase 4 will add a dynamic loader that
 * calls the same PluginRegistry.register() entry point at runtime.)
 */
export const installedPlugins: SDFPlugin[] = []
```

- [ ] **Step 3: Create the bootstrap wiring**

Create `apps/host-twin/lib/pluginBootstrap.ts`:

```typescript
"use client"

import {
  PluginRegistry,
  createPluginContext,
  loadPlugins,
  type PluginContextBindings,
} from "@sdf/plugin-runtime"
import { useFactoryStore } from "@/store/factoryStore"
import { installedPlugins } from "./plugins"

export const pluginRegistry = new PluginRegistry()

function stripFunctions(state: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(state)) {
    if (typeof value !== "function") result[key] = value
  }
  return result
}

export function createHostBindings(): PluginContextBindings {
  return {
    getReadOnlyState: () =>
      stripFunctions(useFactoryStore.getState() as unknown as Record<string, unknown>),
    subscribe: (listener) =>
      useFactoryStore.subscribe(() => listener(useFactoryStore.getState())),
    addRule: (rule) => useFactoryStore.getState().addRule(rule),
    addComputedMetric: (metric) => useFactoryStore.getState().addComputedMetric(metric),
    registerPanelPosition: (id, label, pos) =>
      useFactoryStore.getState().registerPluginPanel(id, label, pos),
  }
}

const pluginContext = createPluginContext(pluginRegistry, createHostBindings())

// React 18 StrictMode double-invokes effects in dev — guard so bootstrapPlugins()
// only runs once per page load (PluginRegistry.register() would otherwise throw
// on the second invocation for the same plugin id).
let bootstrapped = false

export function bootstrapPlugins(): void {
  if (bootstrapped) return
  bootstrapped = true
  loadPlugins(pluginRegistry, installedPlugins, pluginContext)
}
```

- [ ] **Step 4: Verify typecheck**

Run: `pnpm --filter @sdf/host-twin typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/host-twin/package.json apps/host-twin/lib/plugins.ts apps/host-twin/lib/pluginBootstrap.ts pnpm-lock.yaml
git commit -m "feat(host-twin): wire plugin registry to the Zustand store"
```

---

### Task 10: Integration test — full register round trip through the real store

**Files:**
- Test: `apps/host-twin/__tests__/pluginContextIntegration.test.ts`

- [ ] **Step 1: Write the test**

Create `apps/host-twin/__tests__/pluginContextIntegration.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest"
import { PluginRegistry, createPluginContext, loadPlugins } from "@sdf/plugin-runtime"
import { useFactoryStore } from "@/store/factoryStore"
import { createHostBindings } from "@/lib/pluginBootstrap"
import type { SDFPlugin } from "@sdf/types"

beforeEach(() => {
  useFactoryStore.setState({
    layoutConfig: {
      version: 2,
      columns: 3,
      panels: [
        { id: "canvas", label: "3D 캔버스", x: 0, y: 0, w: 2, h: 4, visible: true },
      ],
    },
    rules: [],
    computedMetrics: [],
  })
})

describe("plugin context integration (real factoryStore)", () => {
  it("registers a panel, rule, and metric through the real store", () => {
    const registry = new PluginRegistry()
    const ctx = createPluginContext(registry, createHostBindings())

    const plugin: SDFPlugin = {
      id: "demo-plugin",
      name: "Demo",
      version: "0.1.0",
      activate: (ctx) => {
        ctx.registerPanel({ id: "demo-panel", label: "데모 패널", component: () => "demo content" })
        ctx.registerRule({
          name: "고온 경고",
          condition: "temperature > 90",
          machineId: null,
          actions: [{ type: "alert_popup" }],
          cooldownMs: 5000,
          enabled: true,
        })
        ctx.registerMetric({
          name: "합산 진동",
          formula: "vibration * 2",
          color: "#22d3ee",
          machineId: null,
        })
      },
    }

    loadPlugins(registry, [plugin], ctx)

    const state = useFactoryStore.getState()
    expect(state.layoutConfig.panels.some((p) => p.id === "demo-panel")).toBe(true)
    expect(state.rules).toHaveLength(1)
    expect(state.rules[0].name).toBe("고온 경고")
    expect(state.computedMetrics).toHaveLength(1)
    expect(state.computedMetrics[0].name).toBe("합산 진동")
  })

  it("places a new panel below existing panels by default", () => {
    const registry = new PluginRegistry()
    const ctx = createPluginContext(registry, createHostBindings())
    const plugin: SDFPlugin = {
      id: "demo-plugin-2",
      name: "Demo2",
      version: "0.1.0",
      activate: (ctx) => {
        ctx.registerPanel({ id: "demo-panel-2", label: "데모2", component: () => null })
      },
    }
    loadPlugins(registry, [plugin], ctx)
    const panel = useFactoryStore.getState().layoutConfig.panels.find((p) => p.id === "demo-panel-2")
    expect(panel?.y).toBe(4) // canvas의 y(0) + h(4)
  })

  it("does not add the panel when its id collides with a built-in panel", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const registry = new PluginRegistry()
    const ctx = createPluginContext(registry, createHostBindings())
    const plugin: SDFPlugin = {
      id: "bad-plugin",
      name: "Bad",
      version: "0.1.0",
      activate: (ctx) => {
        ctx.registerPanel({ id: "canvas", label: "충돌", component: () => null })
      },
    }
    loadPlugins(registry, [plugin], ctx)
    const panels = useFactoryStore.getState().layoutConfig.panels
    expect(panels.filter((p) => p.id === "canvas")).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter @sdf/host-twin test -- pluginContextIntegration.test.ts`
Expected: PASS (3 tests). No implementation changes are needed for this task — it validates the wiring built in Tasks 1–9.

- [ ] **Step 3: Commit**

```bash
git add apps/host-twin/__tests__/pluginContextIntegration.test.ts
git commit -m "test(host-twin): add end-to-end plugin registration integration test"
```

---

### Task 11: Wire `bootstrapPlugins()` and merge plugin panels into `page.tsx`

**Files:**
- Modify: `apps/host-twin/app/page.tsx`

- [ ] **Step 1: Add the `useEffect` import and plugin imports**

Find:
```typescript
import { useRef, useState } from "react"
```

Replace with:
```typescript
import { useEffect, useRef, useState } from "react"
```

Find:
```typescript
import { LayoutControlBar, LayoutGrid } from "@/components/LayoutManager"
import { useFactoryStore } from "@/store/factoryStore"
import type { LayoutPanelId } from "@sdf/types"
```

Replace with:
```typescript
import { LayoutControlBar, LayoutGrid } from "@/components/LayoutManager"
import { useFactoryStore } from "@/store/factoryStore"
import { bootstrapPlugins, pluginRegistry } from "@/lib/pluginBootstrap"
import type { LayoutPanelId } from "@sdf/types"
```

- [ ] **Step 2: Call `bootstrapPlugins()` once on mount**

Find (inside `export default function Home()`, right after the `useConfigSync()` line):
```typescript
  const { exportToFile, importFromFile } = useConfigSync()

  const [editingLayout, setEditingLayout] = useState(false)
```

Replace with:
```typescript
  const { exportToFile, importFromFile } = useConfigSync()

  useEffect(() => {
    bootstrapPlugins()
  }, [])

  const [editingLayout, setEditingLayout] = useState(false)
```

- [ ] **Step 3: Merge plugin panels into `panelContent`**

Find:
```typescript
    mes: (
      <DashboardErrorBoundary label="MES 이관 모니터">
        <MesReroutingViewer />
      </DashboardErrorBoundary>
    ),
  }
```

Replace with:
```typescript
    mes: (
      <DashboardErrorBoundary label="MES 이관 모니터">
        <MesReroutingViewer />
      </DashboardErrorBoundary>
    ),

    ...pluginRegistry.getPanelComponents(),
  }
```

- [ ] **Step 4: Verify typecheck and build**

Run: `pnpm --filter @sdf/host-twin typecheck`
Expected: PASS

Run: `pnpm --filter @sdf/host-twin build`
Expected: PASS — Next.js production build completes without error

- [ ] **Step 5: Manual smoke check**

Run: `pnpm --filter @sdf/host-twin dev`

Open `http://localhost:3000` in a browser. Expected: the app loads exactly as before (no visual change, since `installedPlugins` is still empty — this task only wires the plumbing). Check the browser console: no errors from `bootstrapPlugins()` or `pluginRegistry`.

Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add apps/host-twin/app/page.tsx
git commit -m "feat(host-twin): bootstrap plugins on mount and merge plugin panels into the layout grid"
```

---

### Task 12: Full-repo verification

**Files:** none (verification only)

- [ ] **Step 1: Install, typecheck, test, build across the whole monorepo**

Run: `pnpm install`
Expected: no errors

Run: `pnpm typecheck`
Expected: PASS for every package (`@sdf/types`, `@sdf/ui`, `@sdf/core-sdk`, `@sdf/plugin-runtime`, `@sdf/host-twin`)

Run: `pnpm test`
Expected: PASS — all existing `@sdf/host-twin` tests plus the new `@sdf/plugin-runtime` and integration tests, all green

Run: `pnpm build`
Expected: PASS — Turborepo builds every package/app in dependency order without error

- [ ] **Step 2: If any step fails, fix before proceeding**

Do not proceed to Task 13 until all four commands pass cleanly.

---

### Task 13: Changeset and release notes

**Files:**
- Create: `.changeset/<generated-name>.md` (via CLI, not hand-written)

- [ ] **Step 1: Check whether `pnpm changeset` is available**

Run: `pnpm changeset --version`

If this errors with "command not found" or similar, install it as a dev dependency first:

```bash
pnpm add -D -w @changesets/cli
pnpm changeset init
```

- [ ] **Step 2: Generate the changeset**

Run: `pnpm changeset`

When prompted:
- Select `@sdf/plugin-runtime` as the changed package (minor bump — first public API surface)
- Select `@sdf/types` as a changed package (patch bump — `LayoutPanelId`/`PluginPanel` type fixes)
- Summary: `Add @sdf/plugin-runtime: static plugin registry, whitelisted PluginContext, and panel/rule/metric registration wired into the host dashboard.`

- [ ] **Step 3: Commit the changeset**

```bash
git add .changeset
git commit -m "chore: add changeset for @sdf/plugin-runtime initial release"
```

---

## Self-Review Notes

- **Spec coverage:** §2.1 package structure → Task 1/6. §2.2 registry → Task 2/3. §2.3 whitelist context → Task 4. §2.4 panel extensibility → Task 7/8/11. §2.5 error isolation → Task 3. §2.6 static registration flow → Task 9. §3 data flow → validated end-to-end by Task 10. §4 error handling → Task 5 (activate failures), Task 8 (reserved-id collision). §5 testing → Tasks 2–5, 8, 10. §6 release → Task 13. §7 file impact list → matches Tasks 7, 8, 9, 11 exactly.
- **Type consistency verified:** `PluginContextBindings` (Task 4) fields (`getReadOnlyState`, `subscribe`, `addRule`, `addComputedMetric`, `registerPanelPosition`) match exactly between `context.ts`, `pluginBootstrap.ts` (Task 9), and both test files (Tasks 4, 10). `registerPluginPanel(id, label, defaultPosition?)` signature matches across `factoryStore.ts` (Task 8), `context.ts`'s `registerPanelPosition` binding call (Task 4/9), and its test (Task 8).
- **No placeholders:** every step has complete, exact code.
