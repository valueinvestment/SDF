import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { vi } from "vitest"
import { PluginRegistry } from "../registry"
import type { SDFPlugin, PluginProps } from "@sdf/types"

const fakeProps: PluginProps = {
  useStoreSlice: (selector) => selector(undefined),
}

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

describe("PluginRegistry — panel components", () => {
  it("registers a panel component and returns it wrapped for rendering", () => {
    const registry = new PluginRegistry()
    registry.registerPanelComponent("demo", () => "hello from plugin")
    const panels = registry.getPanelComponents(fakeProps)
    render(<div>{panels["demo"]}</div>)
    expect(screen.getByText("hello from plugin")).toBeInTheDocument()
  })

  it("isolates a panel component that throws instead of crashing the tree", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const registry = new PluginRegistry()
    registry.registerPanelComponent("boom", () => {
      throw new Error("plugin exploded")
    })
    const panels = registry.getPanelComponents(fakeProps)
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
