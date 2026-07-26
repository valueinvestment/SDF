import { describe, it, expect, vi } from "vitest"
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

  it("renders multiple rejected entries sharing the same attempted id without a key collision", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const registry = new PluginRegistry()
    registry.recordRejected("dup", "first attempt failed")
    registry.recordRejected("dup", "second attempt failed")
    render(<PluginInspectorPanel registry={registry} />)
    expect(screen.getByText("first attempt failed")).toBeInTheDocument()
    expect(screen.getByText("second attempt failed")).toBeInTheDocument()
    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

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
})
