# Phase 3b — Plugin Inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only introspection API to `PluginRegistry` (`list()`, `getErrors()`, `getAllErrors()`) that records plugin registration/panel-id/activation failures, and surface it through a dev-mode-default-visible `PluginInspectorPanel` built-in panel in the host dashboard.

**Architecture:** A single new `PluginPanelConflictError` class (in `packages/plugin-runtime`) is thrown from both places a panel-id conflict can occur — `PluginRegistry.registerPanelComponent()` (plugin-vs-plugin) and the host's `registerPluginPanel` store action (plugin-vs-built-in) — so `loadPlugins()` can classify errors with a single `instanceof` check at its one recording point. Registration conflicts are recorded directly in `loadPlugins()`'s own loop (no classification needed — `register()` only ever fails one way). The Inspector UI is a presentational component that takes a `PluginRegistry` instance as a prop (not a hook), reading a static snapshot with a manual refresh button.

**Tech Stack:** TypeScript, React 18, Zustand, Vitest + Testing Library, pnpm workspaces (Turbo).

**Design spec:** `docs/superpowers/specs/2026-07-24-plugin-platform-phase3b-inspector-design.md` (read this first for the full rationale — this plan implements it as approved, including two corrections made during planning: `panelIds` was dropped from `PluginSummary`, and `ruleCount`/`metricCount` were deferred to a roadmap backlog item).

---

## File Structure

**`packages/plugin-runtime`** (the plugin SDK — no host/Next.js dependencies):
- `src/errors.ts` (new) — `PluginPanelConflictError`, the one shared error class both conflict sites throw.
- `src/registry.ts` (modify) — new types (`PluginErrorKind`, `PluginError`, `PluginSummary`), new state (`errors`, `rejected`), new methods (`list`, `getErrors`, `getAllErrors`, `recordError`, `recordRejected`), and `registerPanelComponent` now throws `PluginPanelConflictError`.
- `src/loader.ts` (modify) — `loadPlugins()` classifies and records errors instead of only `console.error`-ing them.
- `src/index.ts` (modify) — export the new class and types.

**`apps/host-twin`** (the Next.js host app):
- `store/factoryStore.ts` (modify) — `registerPluginPanel` throws `PluginPanelConflictError`; `BUILT_IN_PANEL_IDS` and `DEFAULT_LAYOUT` gain an `"inspector"` entry, default-visible only when `NODE_ENV !== "production"`.
- `components/PluginInspectorPanel.tsx` (new) — presentational component, takes `registry: PluginRegistry` as a prop.
- `app/page.tsx` (modify) — wires `PluginInspectorPanel` into the `panelContent` map under the `inspector` key, wrapped in `DashboardErrorBoundary` (same pattern as every other built-in panel).

---

### Task 1: `PluginPanelConflictError`

**Files:**
- Create: `packages/plugin-runtime/src/errors.ts`
- Modify: `packages/plugin-runtime/src/index.ts`
- Test: `packages/plugin-runtime/src/__tests__/errors.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/plugin-runtime/src/__tests__/errors.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { PluginPanelConflictError } from "../errors"

describe("PluginPanelConflictError", () => {
  it("is an Error subclass carrying the given message", () => {
    const err = new PluginPanelConflictError("panel id already registered: demo")
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(PluginPanelConflictError)
    expect(err.message).toBe("panel id already registered: demo")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sdf/plugin-runtime test -- errors.test.ts`
Expected: FAIL — `Cannot find module '../errors'` (or similar resolution error).

- [ ] **Step 3: Write minimal implementation**

Create `packages/plugin-runtime/src/errors.ts`:

```ts
export class PluginPanelConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PluginPanelConflictError"
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sdf/plugin-runtime test -- errors.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Export it from the package entry point**

Modify `packages/plugin-runtime/src/index.ts` — add this line (keep the existing four lines as-is):

```ts
export { PluginPanelConflictError } from "./errors"
```

- [ ] **Step 6: Commit**

```bash
git add packages/plugin-runtime/src/errors.ts packages/plugin-runtime/src/index.ts packages/plugin-runtime/src/__tests__/errors.test.ts
git commit -m "feat(plugin-runtime): add PluginPanelConflictError"
```

---

### Task 2: `registerPanelComponent()` throws `PluginPanelConflictError`

**Files:**
- Modify: `packages/plugin-runtime/src/registry.ts`
- Modify: `packages/plugin-runtime/src/__tests__/registry.test.tsx`

- [ ] **Step 1: Write the failing test**

In `packages/plugin-runtime/src/__tests__/registry.test.tsx`, add this import at the top (alongside the existing imports):

```ts
import { PluginPanelConflictError } from "../errors"
```

Then add a new `it` inside the existing `describe("PluginRegistry — panel components", ...)` block, right after the `"rejects registering a duplicate panel id"` test:

```ts
  it("throws specifically a PluginPanelConflictError on duplicate panel id", () => {
    const registry = new PluginRegistry()
    registry.registerPanelComponent("demo", () => "first")
    expect(() => registry.registerPanelComponent("demo", () => "second")).toThrow(
      PluginPanelConflictError,
    )
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sdf/plugin-runtime test -- registry.test.tsx`
Expected: FAIL — the new test fails because `registerPanelComponent` currently throws a plain `Error`, not `PluginPanelConflictError`. (The pre-existing regex-based test on the same throw still passes — message text is unchanged.)

- [ ] **Step 3: Write minimal implementation**

In `packages/plugin-runtime/src/registry.ts`, add the import at the top:

```ts
import { PluginPanelConflictError } from "./errors"
```

Then change `registerPanelComponent`:

```ts
  registerPanelComponent(id: string, component: (props: PluginProps) => unknown): void {
    if (this.panelComponents.has(id)) {
      throw new PluginPanelConflictError(`[PluginRegistry] panel id already registered: ${id}`)
    }
    this.panelComponents.set(id, component)
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sdf/plugin-runtime test -- registry.test.tsx`
Expected: PASS (all tests in the file, including the pre-existing ones)

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-runtime/src/registry.ts packages/plugin-runtime/src/__tests__/registry.test.tsx
git commit -m "fix(plugin-runtime): throw PluginPanelConflictError on panel id collision"
```

---

### Task 3: `PluginRegistry` introspection API

**Files:**
- Modify: `packages/plugin-runtime/src/registry.ts`
- Modify: `packages/plugin-runtime/src/index.ts`
- Modify: `packages/plugin-runtime/src/__tests__/registry.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block at the end of `packages/plugin-runtime/src/__tests__/registry.test.tsx`:

```ts
describe("PluginRegistry — introspection", () => {
  it("list() returns an empty array for a fresh registry", () => {
    const registry = new PluginRegistry()
    expect(registry.list()).toEqual([])
  })

  it("list() includes a summary for each successfully registered plugin", () => {
    const registry = new PluginRegistry()
    registry.register({
      id: "demo",
      name: "Demo",
      version: "1.0.0",
      description: "test plugin",
      activate: () => {},
    })
    expect(registry.list()).toEqual([
      { status: "active", id: "demo", name: "Demo", version: "1.0.0", description: "test plugin" },
    ])
  })

  it("recordRejected() adds a rejected entry surfaced by list()", () => {
    const registry = new PluginRegistry()
    registry.recordRejected("dup", "plugin id already registered: dup")
    const [entry] = registry.list()
    expect(entry).toMatchObject({ status: "rejected", id: "dup", message: "plugin id already registered: dup" })
    expect(typeof (entry as { ts: number }).ts).toBe("number")
  })

  it("getErrors() returns an empty array for a plugin with no recorded errors", () => {
    const registry = new PluginRegistry()
    registry.register(makePlugin("demo"))
    expect(registry.getErrors("demo")).toEqual([])
  })

  it("recordError() adds an entry retrievable via getErrors() and getAllErrors()", () => {
    const registry = new PluginRegistry()
    registry.register(makePlugin("demo"))
    registry.recordError("demo", { kind: "activate_failed", message: "boom", ts: 123 })
    expect(registry.getErrors("demo")).toEqual([{ kind: "activate_failed", message: "boom", ts: 123 }])
    expect(registry.getAllErrors()).toEqual(
      new Map([["demo", [{ kind: "activate_failed", message: "boom", ts: 123 }]]]),
    )
  })
})
```

(`makePlugin` is the helper already defined at the top of this test file — no new import needed for it.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sdf/plugin-runtime test -- registry.test.tsx`
Expected: FAIL — `registry.list is not a function` (and similarly for `getErrors`/`getAllErrors`/`recordError`/`recordRejected`).

- [ ] **Step 3: Write minimal implementation**

In `packages/plugin-runtime/src/registry.ts`, add these type exports near the top of the file (after the imports, before the `PanelRenderer` function):

```ts
export type PluginErrorKind = "register_conflict" | "panel_id_conflict" | "activate_failed"

export interface PluginError {
  kind: PluginErrorKind
  message: string
  ts: number
}

export type PluginSummary =
  | { status: "active"; id: string; name: string; version: string; description?: string }
  | { status: "rejected"; id: string; message: string; ts: number }
```

Add two new private fields to the `PluginRegistry` class (alongside the existing `plugins`/`panelComponents` fields):

```ts
  private errors = new Map<string, PluginError[]>()
  private rejected: { id: string; message: string; ts: number }[] = []
```

Add five new methods to the class (placement doesn't matter — e.g. after `getPanelComponents`):

```ts
  recordRejected(id: string, message: string): void {
    this.rejected.push({ id, message, ts: Date.now() })
  }

  recordError(pluginId: string, error: PluginError): void {
    const list = this.errors.get(pluginId) ?? []
    list.push(error)
    this.errors.set(pluginId, list)
  }

  getErrors(id: string): PluginError[] {
    return this.errors.get(id) ?? []
  }

  getAllErrors(): Map<string, PluginError[]> {
    return new Map(this.errors)
  }

  list(): PluginSummary[] {
    const active: PluginSummary[] = Array.from(this.plugins.values()).map((plugin) => ({
      status: "active",
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
    }))
    const rejected: PluginSummary[] = this.rejected.map((r) => ({ status: "rejected", ...r }))
    return [...active, ...rejected]
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sdf/plugin-runtime test -- registry.test.tsx`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Export the new types**

Modify `packages/plugin-runtime/src/index.ts` — change the `PluginRegistry` export line to also export the new types:

```ts
export { PluginRegistry, type PluginError, type PluginErrorKind, type PluginSummary } from "./registry"
```

- [ ] **Step 6: Run the full package test suite and typecheck**

Run: `pnpm --filter @sdf/plugin-runtime test`
Expected: PASS (all files)

Run: `pnpm --filter @sdf/plugin-runtime typecheck`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add packages/plugin-runtime/src/registry.ts packages/plugin-runtime/src/index.ts packages/plugin-runtime/src/__tests__/registry.test.tsx
git commit -m "feat(plugin-runtime): add PluginRegistry introspection API (list/getErrors/getAllErrors)"
```

---

### Task 4: `loadPlugins()` classifies and records errors

**Files:**
- Modify: `packages/plugin-runtime/src/loader.ts`
- Modify: `packages/plugin-runtime/src/__tests__/loader.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these four `it` blocks inside the existing `describe("loadPlugins", ...)` block in `packages/plugin-runtime/src/__tests__/loader.test.ts` (after the three existing tests):

```ts
  it("records a rejected entry and skips activate() when register() throws (duplicate id)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const registry = new PluginRegistry()
    const ctx = createPluginContext(registry, makeBindings())
    registry.register({ id: "dup", name: "Dup", version: "0.1.0", activate: () => {} })

    const calls: string[] = []
    loadPlugins(
      registry,
      [{ id: "dup", name: "Dup2", version: "0.1.0", activate: () => { calls.push("activated") } }],
      ctx,
    )

    expect(calls).toEqual([])
    const rejected = registry.list().filter((p) => p.status === "rejected")
    expect(rejected).toEqual([
      { status: "rejected", id: "dup", message: expect.stringMatching(/already registered/), ts: expect.any(Number) },
    ])
  })

  it("records an activate_failed error when activate() throws synchronously", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const registry = new PluginRegistry()
    const ctx = createPluginContext(registry, makeBindings())
    loadPlugins(
      registry,
      [{ id: "bad", name: "Bad", version: "0.1.0", activate: () => { throw new Error("boom") } }],
      ctx,
    )
    expect(registry.getErrors("bad")).toEqual([
      { kind: "activate_failed", message: "boom", ts: expect.any(Number) },
    ])
  })

  it("records a panel_id_conflict error when activate() throws PluginPanelConflictError", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const registry = new PluginRegistry()
    const ctx = createPluginContext(registry, makeBindings())
    registry.registerPanelComponent("taken", () => "first")

    loadPlugins(
      registry,
      [{
        id: "conflicting",
        name: "Conflicting",
        version: "0.1.0",
        activate: () => { ctx.registerPanel({ id: "taken", label: "충돌", component: () => "second" }) },
      }],
      ctx,
    )

    expect(registry.getErrors("conflicting")).toEqual([
      { kind: "panel_id_conflict", message: expect.stringMatching(/panel id already registered/), ts: expect.any(Number) },
    ])
  })

  it("records an activate_failed error when activate() returns a rejected promise", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const registry = new PluginRegistry()
    const ctx = createPluginContext(registry, makeBindings())
    loadPlugins(
      registry,
      [{ id: "async-bad", name: "AsyncBad", version: "0.1.0", activate: async () => { throw new Error("async boom") } }],
      ctx,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(registry.getErrors("async-bad")).toEqual([
      { kind: "activate_failed", message: "async boom", ts: expect.any(Number) },
    ])
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sdf/plugin-runtime test -- loader.test.ts`
Expected: FAIL — `registry.getErrors(...)` returns `[]` / `registry.list()` has no rejected entry, because `loadPlugins()` doesn't record anything yet.

- [ ] **Step 3: Write minimal implementation**

Replace the full contents of `packages/plugin-runtime/src/loader.ts`:

```ts
import type { SDFPlugin, PluginContext } from "@sdf/types"
import type { PluginRegistry } from "./registry"
import { PluginPanelConflictError } from "./errors"

export function loadPlugins(
  registry: PluginRegistry,
  plugins: SDFPlugin[],
  ctx: PluginContext,
): void {
  for (const plugin of plugins) {
    try {
      registry.register(plugin)
    } catch (err) {
      console.error(`[loadPlugins] failed to register plugin "${plugin.id}"`, err)
      registry.recordRejected(plugin.id, err instanceof Error ? err.message : String(err))
      continue
    }

    try {
      const result = plugin.activate(ctx)
      if (result instanceof Promise) {
        result.catch((err) => recordActivateError(registry, plugin.id, err))
      }
    } catch (err) {
      recordActivateError(registry, plugin.id, err)
    }
  }
}

function recordActivateError(registry: PluginRegistry, pluginId: string, err: unknown): void {
  console.error(`[loadPlugins] plugin "${pluginId}" activate() failed`, err)
  const message = err instanceof Error ? err.message : String(err)
  const kind = err instanceof PluginPanelConflictError ? "panel_id_conflict" : "activate_failed"
  registry.recordError(pluginId, { kind, message, ts: Date.now() })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sdf/plugin-runtime test -- loader.test.ts`
Expected: PASS — all 7 tests (3 pre-existing + 4 new). The 3 pre-existing tests only assert `console.error` was called and plugin ordering, both still true.

- [ ] **Step 5: Run the full package test suite and typecheck**

Run: `pnpm --filter @sdf/plugin-runtime test && pnpm --filter @sdf/plugin-runtime typecheck`
Expected: PASS, no errors

- [ ] **Step 6: Commit**

```bash
git add packages/plugin-runtime/src/loader.ts packages/plugin-runtime/src/__tests__/loader.test.ts
git commit -m "feat(plugin-runtime): classify and record registration/activation errors in loadPlugins"
```

---

### Task 5: Host's `registerPluginPanel` throws `PluginPanelConflictError`

**Files:**
- Modify: `apps/host-twin/store/factoryStore.ts`
- Modify: `apps/host-twin/__tests__/factoryStore.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/host-twin/__tests__/factoryStore.test.ts`, add this import at the top:

```ts
import { PluginPanelConflictError } from "@sdf/plugin-runtime"
```

Then add this test inside the existing `describe("registerPluginPanel", ...)` block, after the `"throws when the id collides with a built-in panel"` test:

```ts
  it("throws specifically a PluginPanelConflictError (not a plain Error) on built-in id collision", () => {
    expect(() => useFactoryStore.getState().registerPluginPanel("canvas", "충돌")).toThrow(
      PluginPanelConflictError,
    )
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sdf/host-twin test -- factoryStore.test.ts`
Expected: FAIL — `registerPluginPanel` currently throws a plain `Error`, so `toThrow(PluginPanelConflictError)` fails. (The pre-existing regex test on the same throw still passes.)

- [ ] **Step 3: Write minimal implementation**

In `apps/host-twin/store/factoryStore.ts`, add the import near the top with the other `@sdf/*` imports:

```ts
import { PluginPanelConflictError } from "@sdf/plugin-runtime"
```

Change line 561 (`registerPluginPanel`'s throw):

```ts
  registerPluginPanel: (id, label, defaultPosition) => {
    if (BUILT_IN_PANEL_IDS.has(id)) {
      throw new PluginPanelConflictError(`[registerPluginPanel] "${id}"는 내장 패널 id와 충돌합니다`)
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sdf/host-twin test -- factoryStore.test.ts`
Expected: PASS (all tests in the file, including the pre-existing regex-based one)

- [ ] **Step 5: Commit**

```bash
git add apps/host-twin/store/factoryStore.ts apps/host-twin/__tests__/factoryStore.test.ts
git commit -m "fix(host-twin): throw PluginPanelConflictError on built-in panel id collision"
```

---

### Task 6: `"inspector"` built-in panel id + `NODE_ENV`-gated default visibility

**Files:**
- Modify: `apps/host-twin/store/factoryStore.ts`
- Modify: `apps/host-twin/__tests__/factoryStore.test.ts`

- [ ] **Step 1: Write the failing tests**

Add this new `describe` block at the end of `apps/host-twin/__tests__/factoryStore.test.ts`:

```ts
describe("inspector built-in panel", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("is hidden by default when NODE_ENV is production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.resetModules()
    const { useFactoryStore: freshStore } = await import("@/store/factoryStore")
    const panel = freshStore.getState().layoutConfig.panels.find((p) => p.id === "inspector")
    expect(panel?.visible).toBe(false)
  })

  it("is visible by default when NODE_ENV is not production", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.resetModules()
    const { useFactoryStore: freshStore } = await import("@/store/factoryStore")
    const panel = freshStore.getState().layoutConfig.panels.find((p) => p.id === "inspector")
    expect(panel?.visible).toBe(true)
  })

  it("rejects plugin attempts to register the 'inspector' id", () => {
    expect(() => useFactoryStore.getState().registerPluginPanel("inspector", "충돌")).toThrow(
      PluginPanelConflictError,
    )
  })
})
```

Update the vitest import at the top of the file to include `vi` and `afterEach` (the project's `tsconfig.json` doesn't register `vitest/globals` types, so even though `vitest.config.ts` sets `globals: true` at runtime, `tsc --noEmit` needs explicit imports to recognize these names — change `import { describe, it, expect, beforeEach } from "vitest"` to `import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"`).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sdf/host-twin test -- factoryStore.test.ts`
Expected: FAIL — no panel with id `"inspector"` exists yet in `DEFAULT_LAYOUT`, and `"inspector"` isn't in `BUILT_IN_PANEL_IDS` yet (so the third test fails because no error is thrown at all).

- [ ] **Step 3: Write minimal implementation**

In `apps/host-twin/store/factoryStore.ts`, modify `DEFAULT_LAYOUT` and `BUILT_IN_PANEL_IDS`:

```ts
const DEFAULT_LAYOUT: LayoutConfig = {
  version: 2,
  columns: 3,
  panels: [
    { id: "canvas",    label: "3D 캔버스",       x: 0, y: 0, w: 2, h: 4, visible: true },
    { id: "agent",     label: "에이전트 패널",    x: 2, y: 0, w: 1, h: 4, visible: true },
    { id: "charts",    label: "센서 차트",       x: 0, y: 4, w: 1, h: 3, visible: true },
    { id: "detail",    label: "상세 패널",       x: 1, y: 4, w: 1, h: 3, visible: true },
    { id: "rules",     label: "룰 엔진",         x: 2, y: 4, w: 1, h: 3, visible: true },
    { id: "mes",       label: "MES 모니터",      x: 0, y: 7, w: 3, h: 2, visible: true },
    { id: "inspector", label: "플러그인 인스펙터", x: 0, y: 9, w: 3, h: 3, visible: process.env.NODE_ENV !== "production" },
  ],
}

const BUILT_IN_PANEL_IDS = new Set(["canvas", "charts", "agent", "detail", "rules", "mes", "inspector"])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sdf/host-twin test -- factoryStore.test.ts`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Commit**

```bash
git add apps/host-twin/store/factoryStore.ts apps/host-twin/__tests__/factoryStore.test.ts
git commit -m "feat(host-twin): add inspector as a built-in panel, dev-mode-default-visible"
```

---

### Task 7: `PluginInspectorPanel` component

**Files:**
- Create: `apps/host-twin/components/PluginInspectorPanel.tsx`
- Test: `apps/host-twin/__tests__/PluginInspectorPanel.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/host-twin/__tests__/PluginInspectorPanel.test.tsx`:

```tsx
import { describe, it, expect } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { PluginRegistry } from "@sdf/plugin-runtime"
import { PluginInspectorPanel } from "@/components/PluginInspectorPanel"

function makeRegistryWithActivePlugin(): PluginRegistry {
  const registry = new PluginRegistry()
  registry.register({
    id: "demo",
    name: "Demo Plugin",
    version: "1.0.0",
    description: "테스트용",
    activate: () => {},
  })
  return registry
}

describe("PluginInspectorPanel", () => {
  it("shows an empty state when no plugins are registered", () => {
    render(<PluginInspectorPanel registry={new PluginRegistry()} />)
    expect(screen.getByText("등록된 플러그인이 없습니다.")).toBeInTheDocument()
  })

  it("shows an active plugin's id, name, version, and description", () => {
    render(<PluginInspectorPanel registry={makeRegistryWithActivePlugin()} />)
    expect(screen.getByText("Demo Plugin")).toBeInTheDocument()
    expect(screen.getByText("demo@1.0.0")).toBeInTheDocument()
    expect(screen.getByText("테스트용")).toBeInTheDocument()
  })

  it("shows a rejected registration attempt with its failure reason", () => {
    const registry = new PluginRegistry()
    registry.recordRejected("dup", "plugin id already registered: dup")
    render(<PluginInspectorPanel registry={registry} />)
    expect(screen.getByText("dup")).toBeInTheDocument()
    expect(screen.getByText("plugin id already registered: dup")).toBeInTheDocument()
    expect(screen.getByText("등록 거부됨")).toBeInTheDocument()
  })

  it("shows recorded errors for an active plugin with a kind badge", () => {
    const registry = makeRegistryWithActivePlugin()
    registry.recordError("demo", {
      kind: "panel_id_conflict",
      message: "panel id already registered: taken",
      ts: 1,
    })
    render(<PluginInspectorPanel registry={registry} />)
    expect(screen.getByText("패널 id 충돌")).toBeInTheDocument()
    expect(screen.getByText("panel id already registered: taken")).toBeInTheDocument()
  })

  it("re-reads the registry snapshot when the refresh button is clicked", () => {
    const registry = makeRegistryWithActivePlugin()
    render(<PluginInspectorPanel registry={registry} />)
    expect(screen.queryByText("활성화 실패")).not.toBeInTheDocument()

    registry.recordError("demo", { kind: "activate_failed", message: "boom", ts: 1 })
    fireEvent.click(screen.getByText("새로고침"))

    expect(screen.getByText("활성화 실패")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sdf/host-twin test -- PluginInspectorPanel.test.tsx`
Expected: FAIL — `Cannot find module '@/components/PluginInspectorPanel'`

- [ ] **Step 3: Write minimal implementation**

Create `apps/host-twin/components/PluginInspectorPanel.tsx`:

```tsx
"use client"
import { useCallback, useState } from "react"
import type { PluginError, PluginRegistry, PluginSummary } from "@sdf/plugin-runtime"

const KIND_LABEL: Record<PluginError["kind"], string> = {
  register_conflict: "등록 충돌",
  panel_id_conflict: "패널 id 충돌",
  activate_failed: "활성화 실패",
}

type ActiveSummary = Extract<PluginSummary, { status: "active" }>
type RejectedSummary = Extract<PluginSummary, { status: "rejected" }>

function isActive(summary: PluginSummary): summary is ActiveSummary {
  return summary.status === "active"
}

function isRejected(summary: PluginSummary): summary is RejectedSummary {
  return summary.status === "rejected"
}

interface Snapshot {
  summaries: PluginSummary[]
  errors: Map<string, PluginError[]>
}

function readSnapshot(registry: PluginRegistry): Snapshot {
  return { summaries: registry.list(), errors: registry.getAllErrors() }
}

export function PluginInspectorPanel({ registry }: { registry: PluginRegistry }) {
  const [snapshot, setSnapshot] = useState(() => readSnapshot(registry))
  const refresh = useCallback(() => setSnapshot(readSnapshot(registry)), [registry])

  const active = snapshot.summaries.filter(isActive)
  const rejected = snapshot.summaries.filter(isRejected)

  return (
    <div className="bg-gray-900 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">플러그인 인스펙터</h2>
        <button
          onClick={refresh}
          className="text-[10px] px-2 py-1 rounded border border-gray-700 text-gray-400 hover:border-gray-600"
        >
          새로고침
        </button>
      </div>

      {active.length === 0 && rejected.length === 0 && (
        <p className="text-xs text-gray-600">등록된 플러그인이 없습니다.</p>
      )}

      <div className="space-y-2">
        {active.map((plugin) => {
          const errors = snapshot.errors.get(plugin.id) ?? []
          return (
            <div key={plugin.id} className="border border-gray-800 rounded-lg p-3 space-y-1.5">
              <div className="flex items-baseline gap-2">
                <span className="text-gray-200 font-medium text-xs">{plugin.name}</span>
                <span className="text-gray-600 text-[10px] font-mono">
                  {plugin.id}@{plugin.version}
                </span>
              </div>
              {plugin.description && (
                <p className="text-gray-500 text-[11px]">{plugin.description}</p>
              )}
              {errors.map((err, i) => (
                <div key={i} className="flex items-start gap-2 text-[11px]">
                  <span className="px-1.5 py-0.5 rounded bg-fuchsia-900/40 text-fuchsia-300 text-[10px] font-medium flex-shrink-0">
                    {KIND_LABEL[err.kind]}
                  </span>
                  <span className="text-gray-500">{err.message}</span>
                </div>
              ))}
            </div>
          )
        })}

        {rejected.map((entry) => (
          <div key={entry.id} className="border border-fuchsia-800/60 rounded-lg p-3 space-y-1">
            <div className="flex items-baseline gap-2">
              <span className="text-fuchsia-400 font-medium text-xs">{entry.id}</span>
              <span className="px-1.5 py-0.5 rounded bg-fuchsia-900/40 text-fuchsia-300 text-[10px] font-medium">
                등록 거부됨
              </span>
            </div>
            <p className="text-gray-500 text-[11px]">{entry.message}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sdf/host-twin test -- PluginInspectorPanel.test.tsx`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Run the full host-twin test suite and typecheck**

Run: `pnpm --filter @sdf/host-twin test && pnpm --filter @sdf/host-twin typecheck`
Expected: PASS, no errors

- [ ] **Step 6: Commit**

```bash
git add apps/host-twin/components/PluginInspectorPanel.tsx apps/host-twin/__tests__/PluginInspectorPanel.test.tsx
git commit -m "feat(host-twin): add PluginInspectorPanel component"
```

---

### Task 8: Wire `PluginInspectorPanel` into the dashboard grid

**Files:**
- Modify: `apps/host-twin/app/page.tsx`

- [ ] **Step 1: Add the import**

In `apps/host-twin/app/page.tsx`, add this import alongside the other component imports (near `MesReroutingViewer`):

```ts
import { PluginInspectorPanel } from "@/components/PluginInspectorPanel"
```

- [ ] **Step 2: Add the `inspector` entry to `panelContent`**

In the `panelContent` object (the one that ends with `...pluginRegistry.getPanelComponents(pluginProps),`), add a new entry right before that spread:

```tsx
    inspector: (
      <DashboardErrorBoundary label="플러그인 인스펙터">
        <PluginInspectorPanel registry={pluginRegistry} />
      </DashboardErrorBoundary>
    ),

    ...pluginRegistry.getPanelComponents(pluginProps),
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @sdf/host-twin typecheck`
Expected: no errors

(No dedicated test for this step — `page.tsx` has no existing test file in this codebase; other built-in panel wiring in the same file isn't independently tested either. Coverage comes from `PluginInspectorPanel.test.tsx` (Task 7) for the component's behavior and `factoryStore.test.ts` (Task 6) for the panel's default visibility.)

- [ ] **Step 4: Commit**

```bash
git add apps/host-twin/app/page.tsx
git commit -m "feat(host-twin): wire PluginInspectorPanel into the dashboard grid"
```

---

### Task 9: Full-repo verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck every workspace package**

Run: `pnpm typecheck`
Expected: no errors in any of the 5 frontend packages (`@sdf/types`, `@sdf/ui`, `@sdf/core-sdk`, `@sdf/plugin-runtime`, `@sdf/host-twin`)

- [ ] **Step 2: Run every workspace test suite**

Run: `pnpm test`
Expected: all suites pass — `@sdf/plugin-runtime` and `@sdf/host-twin` gain new passing tests from this plan; no other package's tests are touched by this plan and should be unaffected.

- [ ] **Step 3: Production build**

Run: `pnpm build`
Expected: clean build. This is also a live check that the `NODE_ENV=production` branch of the inspector-visibility logic compiles and doesn't throw during Next.js's production build.

- [ ] **Step 4: Manual/static confirmation of the NODE_ENV gate**

Since there's no headless browser tooling available in this dev environment (noted in prior phases' memory), confirm statically instead of visually:

```bash
grep -n "inspector" apps/host-twin/.next/server/app/page.js 2>/dev/null || echo "check built output path for this Next.js version if the above path doesn't exist"
```

The goal is confirming the built production bundle does NOT set the inspector panel's default `visible` to `true` (i.e. the `NODE_ENV !== "production"` check was actually evaluated at build time, not left as a runtime check that silently always passes). If grep-based confirmation isn't feasible for this Next.js version's build output layout, note that as an open item rather than asserting it's verified.

- [ ] **Step 5: Update the roadmap doc**

In `docs/superpowers/specs/2026-07-22-plugin-platform-roadmap-v2.md`, update the Phase 3b line (around line 132, inside the Phase 3 section) to mark it complete, following the same phrasing pattern used for Phase 3a's completion note. Also update the dependency diagram at the bottom (`Phase 3b ──▶ Phase 6` line) if its "완료" annotations need updating to match.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-07-22-plugin-platform-roadmap-v2.md
git commit -m "docs: mark Phase 3b (Plugin Inspector) complete in roadmap"
```

---

## Self-Review Notes

- **Spec coverage:** All spec sections (§2 data model, §3 API, §4 error classification/recording, §5 UI, §6 tests) map to Tasks 1–8. §7 (dependencies) needed no implementation task. The two spec corrections made during planning (drop `panelIds`, defer `ruleCount`/`metricCount` to backlog) are reflected — no task references either field.
- **Placeholder scan:** No TBD/TODO markers. Task 9 Step 4 is deliberately phrased to allow "open item" as an honest outcome (matching the disclosed-gap precedent from Phase 2's PR) rather than asserting a check that can't actually run in this environment.
- **Type consistency:** `PluginErrorKind`/`PluginError`/`PluginSummary` are defined once in Task 3 and referenced identically (same field names, same union shape) in Tasks 4, 7, and 8. `PluginPanelConflictError` is defined once in Task 1 and referenced identically in Tasks 2, 4, 5, 6.
