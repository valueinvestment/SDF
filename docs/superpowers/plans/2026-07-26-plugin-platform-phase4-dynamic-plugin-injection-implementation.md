# Phase 4 — 프런트엔드 런타임 동적 주입 샌드박스 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `loadPluginFromURL(registry, url, ctx)` entry point that dynamically imports and activates a `.js` plugin file at runtime, wired into the existing `PluginInspectorPanel` with an upload UI, plus a committed example plugin demonstrating the flow.

**Architecture:** Refactor `loadPlugins()`'s per-plugin register/activate/error-recording logic into two shared helpers (`registerPlugin`, `activateAndRecord`) so a new `loadPluginFromURL()` can reuse them unchanged. The upload UI in `PluginInspectorPanel` creates a `Blob` URL from an uploaded file's text, calls `loadPluginFromURL`, and refreshes the existing snapshot — no new error-display machinery, no persistence, no per-plugin context.

**Tech Stack:** TypeScript, React, Vitest + @testing-library/react, native browser `import()` (no bundler involvement for the dynamic URL).

**Design spec:** `docs/superpowers/specs/2026-07-26-plugin-platform-phase4-dynamic-plugin-injection-design.md`

---

### Task 1: Refactor `loadPlugins()` and add `loadPluginFromURL()`

**Files:**
- Modify: `packages/plugin-runtime/src/loader.ts`
- Modify: `packages/plugin-runtime/src/index.ts`
- Test: `packages/plugin-runtime/src/__tests__/loader.test.ts`

The existing `loader.ts` (read in full below) has per-plugin register/activate/error-recording logic inlined in a `for` loop inside `loadPlugins()`. This task extracts that logic into two standalone functions (`registerPlugin`, `activateAndRecord`) with no behavior change, verified by the fact that all 7 existing tests in `loader.test.ts` still pass unmodified. Then it adds `loadPluginFromURL()`, which reuses those same two functions.

- [ ] **Step 1: Write the failing tests for `loadPluginFromURL`**

First, change the existing import line at the top of `packages/plugin-runtime/src/__tests__/loader.test.ts` (line 4) from:

```ts
import { loadPlugins } from "../loader"
```

to:

```ts
import { loadPlugins, loadPluginFromURL } from "../loader"
```

Then append a new `describe` block after the existing `describe("loadPlugins", ...)` block (same file, no new imports needed since `loadPluginFromURL` is now imported at the top):

```ts
describe("loadPluginFromURL", () => {
  it("loads, registers, and activates a plugin from a data: URL", async () => {
    const registry = new PluginRegistry()
    const ctx = createPluginContext(registry, makeBindings())
    const url =
      "data:text/javascript," +
      encodeURIComponent(
        `export default { id: "dyn", name: "Dyn", version: "0.1.0", activate: (ctx) => { globalThis.__dynActivated = true } }`,
      )

    await loadPluginFromURL(registry, url, ctx)

    expect(registry.has("dyn")).toBe(true)
    expect((globalThis as Record<string, unknown>).__dynActivated).toBe(true)
    delete (globalThis as Record<string, unknown>).__dynActivated
  })

  it("throws and does not register when the module's default export is missing activate", async () => {
    const registry = new PluginRegistry()
    const ctx = createPluginContext(registry, makeBindings())
    const url =
      "data:text/javascript," +
      encodeURIComponent(`export default { id: "bad-shape", name: "Bad", version: "0.1.0" }`)

    await expect(loadPluginFromURL(registry, url, ctx)).rejects.toThrow(
      /default export/,
    )
    expect(registry.has("bad-shape")).toBe(false)
  })

  it("throws when the module has no default export at all", async () => {
    const registry = new PluginRegistry()
    const ctx = createPluginContext(registry, makeBindings())
    const url = "data:text/javascript," + encodeURIComponent(`export const notDefault = {}`)

    await expect(loadPluginFromURL(registry, url, ctx)).rejects.toThrow(/default export/)
  })

  it("records a rejected entry when register() throws (duplicate id), matching loadPlugins()", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const registry = new PluginRegistry()
    const ctx = createPluginContext(registry, makeBindings())
    registry.register({ id: "dup", name: "Dup", version: "0.1.0", activate: () => {} })
    const url =
      "data:text/javascript," +
      encodeURIComponent(`export default { id: "dup", name: "Dup2", version: "0.1.0", activate: () => {} }`)

    await loadPluginFromURL(registry, url, ctx)

    const rejected = registry.list().filter((p) => p.status === "rejected")
    expect(rejected).toEqual([
      { status: "rejected", id: "dup", message: expect.stringMatching(/already registered/), ts: expect.any(Number) },
    ])
  })

  it("records an activate_failed error when activate() throws, matching loadPlugins()", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const registry = new PluginRegistry()
    const ctx = createPluginContext(registry, makeBindings())
    const url =
      "data:text/javascript," +
      encodeURIComponent(
        `export default { id: "boom", name: "Boom", version: "0.1.0", activate: () => { throw new Error("dyn boom") } }`,
      )

    await loadPluginFromURL(registry, url, ctx)

    expect(registry.getErrors("boom")).toEqual([
      { kind: "activate_failed", message: "dyn boom", ts: expect.any(Number) },
    ])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/plugin-runtime && pnpm vitest run src/__tests__/loader.test.ts`
Expected: FAIL — `loadPluginFromURL` is not exported from `../loader`.

- [ ] **Step 3: Refactor `loadPlugins()` and implement `loadPluginFromURL()`**

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
    if (!registerPlugin(registry, plugin)) continue
    activateAndRecord(registry, plugin, ctx)
  }
}

export async function loadPluginFromURL(
  registry: PluginRegistry,
  url: string,
  ctx: PluginContext,
): Promise<void> {
  const module = await import(/* webpackIgnore: true */ url)
  const plugin = module.default
  assertPluginShape(plugin)
  if (!registerPlugin(registry, plugin)) return
  activateAndRecord(registry, plugin, ctx)
}

function registerPlugin(registry: PluginRegistry, plugin: SDFPlugin): boolean {
  try {
    registry.register(plugin)
    return true
  } catch (err) {
    console.error(`[loadPlugins] failed to register plugin "${plugin.id}"`, err)
    registry.recordRejected(plugin.id, err instanceof Error ? err.message : String(err))
    return false
  }
}

function activateAndRecord(registry: PluginRegistry, plugin: SDFPlugin, ctx: PluginContext): void {
  try {
    const result = plugin.activate(ctx)
    if (result instanceof Promise) {
      result.catch((err) => recordActivateError(registry, plugin.id, err))
    }
  } catch (err) {
    recordActivateError(registry, plugin.id, err)
  }
}

function recordActivateError(registry: PluginRegistry, pluginId: string, err: unknown): void {
  console.error(`[loadPlugins] plugin "${pluginId}" activate() failed`, err)
  const message = err instanceof Error ? err.message : String(err)
  const kind = err instanceof PluginPanelConflictError ? "panel_id_conflict" : "activate_failed"
  registry.recordError(pluginId, { kind, message, ts: Date.now() })
}

function assertPluginShape(plugin: unknown): asserts plugin is SDFPlugin {
  if (
    !plugin ||
    typeof (plugin as SDFPlugin).id !== "string" ||
    typeof (plugin as SDFPlugin).name !== "string" ||
    typeof (plugin as SDFPlugin).version !== "string" ||
    typeof (plugin as SDFPlugin).activate !== "function"
  ) {
    throw new Error("업로드된 파일이 유효한 SDFPlugin을 default export하지 않습니다")
  }
}
```

Then add the new export to `packages/plugin-runtime/src/index.ts`. Current content:

```ts
export { PluginRegistry, type PluginError, type PluginErrorKind, type PluginSummary, type PanelRenderError } from "./registry"
export { createPluginContext, createPluginProps, type PluginContextBindings } from "./context"
export { loadPlugins } from "./loader"
export { createUseStoreSlice } from "./useStoreSlice"
export { PluginPanelConflictError } from "./errors"
```

Change the `loader` export line to:

```ts
export { loadPlugins, loadPluginFromURL } from "./loader"
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/plugin-runtime && pnpm vitest run src/__tests__/loader.test.ts`
Expected: PASS — all 12 tests (7 existing `loadPlugins` + 5 new `loadPluginFromURL`).

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-runtime/src/loader.ts packages/plugin-runtime/src/index.ts packages/plugin-runtime/src/__tests__/loader.test.ts
git commit -m "feat(plugin-runtime): add loadPluginFromURL for runtime dynamic plugin loading"
```

---

### Task 2: Extend `PluginInspectorPanel` with a plugin upload section

**Files:**
- Modify: `apps/host-twin/components/PluginInspectorPanel.tsx`
- Test: `apps/host-twin/__tests__/PluginInspectorPanel.test.tsx`

This task adds a required `pluginContext: PluginContext` prop (needed to call `loadPluginFromURL`) and a drag-drop/file-picker upload section at the bottom of the panel. Because the prop becomes required, every existing test's `render(<PluginInspectorPanel ... />)` call needs a `pluginContext` value too — a mechanical, no-behavior-change update to the existing test file, done first so the baseline stays green before adding new upload tests.

- [ ] **Step 1: Update the existing test file to supply `pluginContext`, and write the failing upload tests**

Replace the full contents of `apps/host-twin/__tests__/PluginInspectorPanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { PluginRegistry, createPluginContext, loadPluginFromURL } from "@sdf/plugin-runtime"
import { PluginInspectorPanel } from "@/components/PluginInspectorPanel"

vi.mock("@sdf/plugin-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sdf/plugin-runtime")>()
  return { ...actual, loadPluginFromURL: vi.fn() }
})

function makeBindings() {
  return {
    getReadOnlyState: () => ({}),
    subscribe: () => () => {},
    addRule: vi.fn(),
    addComputedMetric: vi.fn(),
    registerPanelPosition: vi.fn(),
  }
}

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
    const registry = new PluginRegistry()
    render(<PluginInspectorPanel registry={registry} pluginContext={createPluginContext(registry, makeBindings())} />)
    expect(screen.getByText("등록된 플러그인이 없습니다.")).toBeInTheDocument()
  })

  it("shows an active plugin's id, name, version, and description", () => {
    const registry = makeRegistryWithActivePlugin()
    render(<PluginInspectorPanel registry={registry} pluginContext={createPluginContext(registry, makeBindings())} />)
    expect(screen.getByText("Demo Plugin")).toBeInTheDocument()
    expect(screen.getByText("demo@1.0.0")).toBeInTheDocument()
    expect(screen.getByText("테스트용")).toBeInTheDocument()
  })

  it("shows a rejected registration attempt with its failure reason", () => {
    const registry = new PluginRegistry()
    registry.recordRejected("dup", "plugin id already registered: dup")
    render(<PluginInspectorPanel registry={registry} pluginContext={createPluginContext(registry, makeBindings())} />)
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
    render(<PluginInspectorPanel registry={registry} pluginContext={createPluginContext(registry, makeBindings())} />)
    expect(screen.getByText("패널 id 충돌")).toBeInTheDocument()
    expect(screen.getByText("panel id already registered: taken")).toBeInTheDocument()
  })

  it("re-reads the registry snapshot when the refresh button is clicked", () => {
    const registry = makeRegistryWithActivePlugin()
    render(<PluginInspectorPanel registry={registry} pluginContext={createPluginContext(registry, makeBindings())} />)
    expect(screen.queryByText("활성화 실패")).not.toBeInTheDocument()

    registry.recordError("demo", { kind: "activate_failed", message: "boom", ts: 1 })
    fireEvent.click(screen.getByText("새로고침"))

    expect(screen.getByText("활성화 실패")).toBeInTheDocument()
  })

  it("renders multiple rejected entries sharing the same attempted id without a key collision", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const registry = new PluginRegistry()
    registry.recordRejected("dup", "first attempt failed")
    registry.recordRejected("dup", "second attempt failed")
    render(<PluginInspectorPanel registry={registry} pluginContext={createPluginContext(registry, makeBindings())} />)
    expect(screen.getByText("first attempt failed")).toBeInTheDocument()
    expect(screen.getByText("second attempt failed")).toBeInTheDocument()
    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it("shows panel render errors under a '패널 렌더링 에러' section", () => {
    const registry = new PluginRegistry()
    registry.recordRenderError("demo-panel", { message: "render boom", ts: 1 })
    render(<PluginInspectorPanel registry={registry} pluginContext={createPluginContext(registry, makeBindings())} />)
    expect(screen.getByText("패널 렌더링 에러")).toBeInTheDocument()
    expect(screen.getByText("demo-panel")).toBeInTheDocument()
    expect(screen.getByText("render boom")).toBeInTheDocument()
  })

  it("shows backend errors under a '백엔드 에러' section", () => {
    const registry = new PluginRegistry()
    render(
      <PluginInspectorPanel
        registry={registry}
        pluginContext={createPluginContext(registry, makeBindings())}
        backendErrors={[{ source: "collector", id: "c1", message: "collect failed", ts: 1 }]}
      />,
    )
    expect(screen.getByText("백엔드 에러")).toBeInTheDocument()
    expect(screen.getByText("Collector")).toBeInTheDocument()
    expect(screen.getByText("c1")).toBeInTheDocument()
    expect(screen.getByText("collect failed")).toBeInTheDocument()
  })

  it("does not show the render-error or backend-error sections when there are none", () => {
    const registry = new PluginRegistry()
    render(<PluginInspectorPanel registry={registry} pluginContext={createPluginContext(registry, makeBindings())} />)
    expect(screen.queryByText("패널 렌더링 에러")).not.toBeInTheDocument()
    expect(screen.queryByText("백엔드 에러")).not.toBeInTheDocument()
  })

  it("loads a dropped/selected file via loadPluginFromURL and refreshes on success", async () => {
    const registry = makeRegistryWithActivePlugin()
    const ctx = createPluginContext(registry, makeBindings())
    vi.mocked(loadPluginFromURL).mockImplementation(async () => {
      registry.register({ id: "dyn", name: "Dyn", version: "0.1.0", activate: () => {} })
    })
    const originalCreateObjectURL = URL.createObjectURL
    const originalRevokeObjectURL = URL.revokeObjectURL
    URL.createObjectURL = vi.fn(() => "blob:fake-url")
    URL.revokeObjectURL = vi.fn()

    render(<PluginInspectorPanel registry={registry} pluginContext={ctx} />)
    const file = new File(["export default {}"], "plugin.js", { type: "text/javascript" })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText("Dyn")).toBeInTheDocument()
    })
    expect(loadPluginFromURL).toHaveBeenCalledWith(registry, "blob:fake-url", ctx)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake-url")

    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
  })

  it("shows an inline error when loadPluginFromURL rejects", async () => {
    const registry = new PluginRegistry()
    const ctx = createPluginContext(registry, makeBindings())
    vi.mocked(loadPluginFromURL).mockRejectedValueOnce(new Error("업로드된 파일이 유효한 SDFPlugin을 default export하지 않습니다"))
    URL.createObjectURL = vi.fn(() => "blob:fake-url")
    URL.revokeObjectURL = vi.fn()

    render(<PluginInspectorPanel registry={registry} pluginContext={ctx} />)
    const file = new File(["not a plugin"], "bad.js", { type: "text/javascript" })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText(/유효한 SDFPlugin을 default export하지 않습니다/)).toBeInTheDocument()
    })
  })

  it("loads a file dropped onto the upload dropzone", async () => {
    const registry = makeRegistryWithActivePlugin()
    const ctx = createPluginContext(registry, makeBindings())
    vi.mocked(loadPluginFromURL).mockImplementation(async () => {
      registry.register({ id: "dyn2", name: "Dyn2", version: "0.1.0", activate: () => {} })
    })
    URL.createObjectURL = vi.fn(() => "blob:fake-url")
    URL.revokeObjectURL = vi.fn()

    render(<PluginInspectorPanel registry={registry} pluginContext={ctx} />)
    const file = new File(["export default {}"], "plugin.js", { type: "text/javascript" })
    const dropzone = screen.getByText(".js 파일을 드래그하거나 클릭하여 업로드").parentElement!
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText("Dyn2")).toBeInTheDocument()
    })
  })
})
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `cd apps/host-twin && pnpm vitest run __tests__/PluginInspectorPanel.test.tsx`
Expected: FAIL — `PluginInspectorPanel` doesn't accept a `pluginContext` prop yet, and there is no upload dropzone/input to interact with.

- [ ] **Step 3: Implement the upload section**

Replace the full contents of `apps/host-twin/components/PluginInspectorPanel.tsx`:

```tsx
"use client"
import { useCallback, useRef, useState, type ChangeEvent, type DragEvent } from "react"
import { loadPluginFromURL, type PluginError, type PluginRegistry, type PluginSummary, type PanelRenderError } from "@sdf/plugin-runtime"
import type { PluginContext, PluginErrorEvent } from "@sdf/types"

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
  renderErrors: Map<string, PanelRenderError[]>
}

function readSnapshot(registry: PluginRegistry): Snapshot {
  return {
    summaries: registry.list(),
    errors: registry.getAllErrors(),
    renderErrors: registry.getAllRenderErrors(),
  }
}

export function PluginInspectorPanel({
  registry,
  pluginContext,
  backendErrors = [],
}: {
  registry: PluginRegistry
  pluginContext: PluginContext
  backendErrors?: PluginErrorEvent[]
}) {
  const [snapshot, setSnapshot] = useState(() => readSnapshot(registry))
  const refresh = useCallback(() => setSnapshot(readSnapshot(registry)), [registry])
  const [dragOver, setDragOver] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const active = snapshot.summaries.filter(isActive)
  const rejected = snapshot.summaries.filter(isRejected)

  const handleFileUpload = useCallback(async (file: File) => {
    setUploadError(null)
    const text = await file.text()
    const blob = new Blob([text], { type: "text/javascript" })
    const url = URL.createObjectURL(blob)
    try {
      await loadPluginFromURL(registry, url, pluginContext)
      refresh()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "플러그인 로드 실패")
    } finally {
      URL.revokeObjectURL(url)
    }
  }, [registry, pluginContext, refresh])

  const handleFileDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFileUpload(file)
  }

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFileUpload(file)
  }

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

        {rejected.map((entry, i) => (
          <div key={i} className="border border-fuchsia-800/60 rounded-lg p-3 space-y-1">
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

      <div className="space-y-1.5 border-t border-gray-800 pt-3">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">플러그인 업로드 (개발용)</h3>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleFileDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-3 text-center cursor-pointer transition-colors ${
            dragOver ? "border-emerald-400 bg-emerald-900/20" : "border-gray-600 hover:border-gray-500"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".js"
            onChange={handleFileSelect}
            className="hidden"
          />
          <p className="text-xs text-gray-400">.js 파일을 드래그하거나 클릭하여 업로드</p>
        </div>
        <p className="text-[11px] text-gray-600">예시: examples/plugins/machine-counter-plugin.js를 업로드해보세요</p>
        {uploadError && <p className="text-xs text-red-400">{uploadError}</p>}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/host-twin && pnpm vitest run __tests__/PluginInspectorPanel.test.tsx`
Expected: PASS — all 12 tests (9 existing, updated with `pluginContext`, + 3 new upload tests).

- [ ] **Step 5: Commit**

```bash
git add apps/host-twin/components/PluginInspectorPanel.tsx apps/host-twin/__tests__/PluginInspectorPanel.test.tsx
git commit -m "feat(host-twin): add plugin upload section to PluginInspectorPanel"
```

---

### Task 3: Wire the `pluginContext` prop through `page.tsx`

**Files:**
- Modify: `apps/host-twin/app/page.tsx`

- [ ] **Step 1: Pass `pluginContext` to `PluginInspectorPanel`**

In `apps/host-twin/app/page.tsx`, the import at line 23 already brings in `pluginContext`:

```ts
import { bootstrapPlugins, pluginRegistry, pluginProps } from "@/lib/pluginBootstrap"
```

Change it to also import `pluginContext`:

```ts
import { bootstrapPlugins, pluginRegistry, pluginProps, pluginContext } from "@/lib/pluginBootstrap"
```

Then find the existing `inspector:` panel block (around line 119-126):

```tsx
    inspector: (
      <DashboardErrorBoundary label="플러그인 인스펙터">
        <PluginInspectorPanel
          key={pluginsReady ? "ready" : "loading"}
          registry={pluginRegistry}
          backendErrors={backendPluginErrors}
        />
      </DashboardErrorBoundary>
```

Add the `pluginContext` prop:

```tsx
    inspector: (
      <DashboardErrorBoundary label="플러그인 인스펙터">
        <PluginInspectorPanel
          key={pluginsReady ? "ready" : "loading"}
          registry={pluginRegistry}
          pluginContext={pluginContext}
          backendErrors={backendPluginErrors}
        />
      </DashboardErrorBoundary>
```

- [ ] **Step 2: Verify the whole app still typechecks and builds**

Run: `cd apps/host-twin && pnpm typecheck`
Expected: PASS, no errors.

Run: `pnpm build` (from repo root, or `cd apps/host-twin && pnpm build`)
Expected: build succeeds. This also lets you confirm — by grepping the build output or checking `pnpm dev` in a browser — that the dynamic `import(/* webpackIgnore: true */ url)` in `loader.ts` doesn't trigger a webpack build-time resolution error (it shouldn't, since the argument is a runtime variable, not a string literal).

- [ ] **Step 3: Commit**

```bash
git add apps/host-twin/app/page.tsx
git commit -m "feat(host-twin): pass pluginContext into PluginInspectorPanel"
```

---

### Task 4: Add the committed example plugin

**Files:**
- Create: `examples/plugins/machine-counter-plugin.js`

This file is not imported or tested by the app — it exists purely as something a developer can drag into the upload dropzone to see the feature work end-to-end, mirroring `examples/sdfrec/sample-session.sdfrec` from Phase 7. It deliberately has zero imports: a plugin loaded via a `blob:`/`data:` URL through native `import()` has no bundler resolving bare specifiers like `"react"`, so it can only use what `activate(ctx)` and the panel's `PluginProps` argument hand it directly.

- [ ] **Step 1: Create the example plugin file**

```js
// SDF Digital Twin — 예시 플러그인 (런타임 업로드용)
// PluginInspectorPanel의 "플러그인 업로드" 영역에 이 파일을 드래그하면
// 빌드/재배포 없이 즉시 로드·활성화됩니다.
//
// 이 파일은 어떤 패키지도 import하지 않습니다 — 브라우저가 Blob URL을 통해
// 네이티브로 동적 import()하는 평범한 ES 모듈이라, 번들러가 해석해주는
// "react" 같은 bare specifier를 import할 수 없습니다. activate(ctx)로
// 전달되는 PluginContext와, 패널 컴포넌트가 받는 PluginProps만으로
// 동작해야 합니다.

export default {
  id: "example-machine-counter",
  name: "Example: Machine Counter",
  version: "0.1.0",
  activate(ctx) {
    ctx.registerPanel({
      id: "example-machine-counter-panel",
      label: "예시: 머신 카운터",
      component: (props) => {
        const machines = props.useStoreSlice((state) => state.machines)
        const count = machines ? Object.keys(machines).length : 0
        return `현재 등록된 머신 수: ${count}`
      },
    })
  },
}
```

- [ ] **Step 2: Manually verify the example plugin loads in a running app**

Run: `pnpm dev` (from repo root or `apps/host-twin`)

In the browser, open the app, find the "플러그인 업로드 (개발용)" section in the Plugin Inspector panel, and drag `examples/plugins/machine-counter-plugin.js` onto the dropzone (or click to pick it via the file dialog). Confirm:
- The plugin appears in the "Example: Machine Counter" active list with no errors.
- A new panel labeled "예시: 머신 카운터" appears somewhere in the layout showing "현재 등록된 머신 수: N".
- The browser console shows no unexpected errors (a webpack "Critical dependency" warning at build time, if any, is expected and harmless — only new *runtime* errors matter here).

This step has no automated test — it is the one thing this plan cannot verify without a real browser, matching the design spec's "구현 단계 실측 필요 사항" section.

- [ ] **Step 3: Commit**

```bash
git add examples/plugins/machine-counter-plugin.js
git commit -m "docs(examples): add machine-counter-plugin.js as a runtime-upload example"
```

---

### Task 5: Update the roadmap doc

**Files:**
- Modify: `docs/superpowers/specs/2026-07-22-plugin-platform-roadmap-v2.md`

- [ ] **Step 1: Mark Phase 4 complete**

Find the Phase 4 section (starts with `## Phase 4 — 프런트엔드 런타임 동적 주입 샌드박스`). Change the heading and add a status line, following the same pattern used for completed phases elsewhere in this doc (e.g. Phase 6's `## Phase 6 — ErrorBoundary 기반 플러그인 모니터링 대시보드 (완료)`):

```markdown
## Phase 4 — 프런트엔드 런타임 동적 주입 샌드박스 (완료)

**상태:** 구현 완료. 상세 설계는 `2026-07-26-plugin-platform-phase4-dynamic-plugin-injection-design.md`, 구현 계획은 `2026-07-26-plugin-platform-phase4-dynamic-plugin-injection-implementation.md` 참조.

**실제 구현:** 위협 모델을 신뢰된 개발자 전용으로 확정하고(iframe 격리 불필요), `PluginRegistry.register()`를 그대로 재사용하는 `loadPluginFromURL(registry, url, ctx)`를 `loadPlugins()`와 공유하는 `registerPlugin`/`activateAndRecord` 헬퍼 위에 구현했다. 업로드 UI는 새 패널이 아니라 기존 `PluginInspectorPanel`에 통합했으며, `examples/plugins/machine-counter-plugin.js`를 시연용으로 커밋했다.

**목표:** 재빌드 없이 `.js` 플러그인 파일을 업로드하면 `import()`로 런타임에 로드되어 즉시 활성화되는 기능. Phase 0의 `PluginRegistry.register()`를 그대로 재사용하고, 위에 `loadPluginFromURL(url, ctx)` 진입점만 추가한다 — 레지스트리의 공개 API는 바뀌지 않는다(Phase 0 설계 문서 §2.2에서 이미 이렇게 설계됨).
```

(Keep the original `목표` paragraph below the new `실제 구현` paragraph, matching how Phase 7's doc update handled the same situation — don't delete the original goal statement, just contextualize it.)

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-07-22-plugin-platform-roadmap-v2.md
git commit -m "docs: mark Phase 4 complete in roadmap"
```

---

## Final Verification

After all tasks:

Run: `pnpm typecheck` (repo root)
Expected: PASS across all packages.

Run: `pnpm test` (repo root)
Expected: PASS across all packages, including the new `loadPluginFromURL` and `PluginInspectorPanel` upload tests.

Run: `pnpm build` (repo root)
Expected: PASS.
