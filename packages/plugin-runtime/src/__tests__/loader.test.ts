import { describe, it, expect, vi } from "vitest"
import { PluginRegistry } from "../registry"
import { createPluginContext } from "../context"
import { loadPlugins, loadPluginFromURL } from "../loader"
import type { SDFPlugin } from "@sdf/types"

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
})

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
