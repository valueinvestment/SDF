import { describe, it, expect } from "vitest"
import { PluginRegistry } from "../registry"
import type { SDFPlugin } from "@sdf/types"

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
