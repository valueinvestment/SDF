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
