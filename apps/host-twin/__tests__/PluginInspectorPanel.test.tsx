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
    setDemoMode: vi.fn(),
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
