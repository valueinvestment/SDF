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
