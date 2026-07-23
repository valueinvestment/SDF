import { describe, it, expect, vi } from "vitest"
import { createElement } from "react"
import { render, screen } from "@testing-library/react"
import { PluginRegistry } from "../registry"
import { createPluginContext, createPluginProps } from "../context"

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
    expect(registry.getPanelComponents()).toHaveProperty("p1")
    expect(bindings.registerPanelPosition).toHaveBeenCalledWith("p1", "Panel 1", undefined)
  })

  it("calls registerPanelPosition before registerPanelComponent", () => {
    const bindings = makeBindings()
    const registry = new PluginRegistry()
    const order: string[] = []
    bindings.registerPanelPosition.mockImplementation(() => order.push("position"))
    vi.spyOn(registry, "registerPanelComponent").mockImplementation(() => order.push("component"))
    const ctx = createPluginContext(registry, bindings)
    ctx.registerPanel({ id: "p1", label: "Panel 1", component: () => "hi" })
    expect(order).toEqual(["position", "component"])
  })

  it("does not leave an orphaned entry in the registry when registerPanelPosition throws (e.g. built-in id collision)", () => {
    const bindings = makeBindings()
    bindings.registerPanelPosition.mockImplementation(() => {
      throw new Error('[registerPluginPanel] "canvas"는 내장 패널 id와 충돌합니다')
    })
    const registry = new PluginRegistry()
    const registerPanelComponentSpy = vi.spyOn(registry, "registerPanelComponent")
    const ctx = createPluginContext(registry, bindings)

    expect(() =>
      ctx.registerPanel({ id: "canvas", label: "충돌", component: () => "malicious" }),
    ).toThrow()

    expect(registerPanelComponentSpy).not.toHaveBeenCalled()
    expect(registry.getPanelComponents()).not.toHaveProperty("canvas")
  })
})

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
