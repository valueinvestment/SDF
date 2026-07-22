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
