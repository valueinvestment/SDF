import { describe, it, expect, beforeEach, vi } from "vitest"
import { PluginRegistry, createPluginContext, createPluginProps, loadPlugins } from "@sdf/plugin-runtime"
import { useFactoryStore } from "@/store/factoryStore"
import { createHostBindings } from "@/lib/pluginBootstrap"
import type { SDFPlugin } from "@sdf/types"

beforeEach(() => {
  useFactoryStore.setState({
    layoutConfig: {
      version: 2,
      columns: 3,
      panels: [
        { id: "canvas", label: "3D 캔버스", x: 0, y: 0, w: 2, h: 4, visible: true },
      ],
    },
    rules: [],
    computedMetrics: [],
  })
})

describe("plugin context integration (real factoryStore)", () => {
  it("registers a panel, rule, and metric through the real store", () => {
    const registry = new PluginRegistry()
    const ctx = createPluginContext(registry, createHostBindings())

    const plugin: SDFPlugin = {
      id: "demo-plugin",
      name: "Demo",
      version: "0.1.0",
      activate: (ctx) => {
        ctx.registerPanel({ id: "demo-panel", label: "데모 패널", component: () => "demo content" })
        ctx.registerRule({
          name: "고온 경고",
          condition: "temperature > 90",
          machineId: null,
          actions: [{ type: "alert_popup" }],
          cooldownMs: 5000,
          enabled: true,
        })
        ctx.registerMetric({
          name: "합산 진동",
          formula: "vibration * 2",
          color: "#22d3ee",
          machineId: null,
        })
      },
    }

    loadPlugins(registry, [plugin], ctx)

    const state = useFactoryStore.getState()
    expect(state.layoutConfig.panels.some((p) => p.id === "demo-panel")).toBe(true)
    expect(state.rules).toHaveLength(1)
    expect(state.rules[0].name).toBe("고온 경고")
    expect(state.computedMetrics).toHaveLength(1)
    expect(state.computedMetrics[0].name).toBe("합산 진동")
  })

  it("places a new panel below existing panels by default", () => {
    const registry = new PluginRegistry()
    const ctx = createPluginContext(registry, createHostBindings())
    const plugin: SDFPlugin = {
      id: "demo-plugin-2",
      name: "Demo2",
      version: "0.1.0",
      activate: (ctx) => {
        ctx.registerPanel({ id: "demo-panel-2", label: "데모2", component: () => null })
      },
    }
    loadPlugins(registry, [plugin], ctx)
    const panel = useFactoryStore.getState().layoutConfig.panels.find((p) => p.id === "demo-panel-2")
    expect(panel?.y).toBe(4) // canvas의 y(0) + h(4)
  })

  it("does not add the panel when its id collides with a built-in panel", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const registry = new PluginRegistry()
    const ctx = createPluginContext(registry, createHostBindings())
    const plugin: SDFPlugin = {
      id: "bad-plugin",
      name: "Bad",
      version: "0.1.0",
      activate: (ctx) => {
        ctx.registerPanel({ id: "canvas", label: "충돌", component: () => null })
      },
    }
    loadPlugins(registry, [plugin], ctx)
    const panels = useFactoryStore.getState().layoutConfig.panels
    expect(panels.filter((p) => p.id === "canvas")).toHaveLength(1)

    // The store correctly rejected the collision, but that rejection must not
    // leave the plugin's component orphaned in the registry — otherwise
    // `{ ...builtInPanels, ...pluginRegistry.getPanelComponents() }` at the
    // render layer would let it silently shadow the real built-in canvas panel.
    const props = createPluginProps(createHostBindings())
    expect(registry.getPanelComponents(props)).not.toHaveProperty("canvas")
  })

  it("records a panel_id_conflict error when a plugin's panel id collides with a built-in panel", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const registry = new PluginRegistry()
    const ctx = createPluginContext(registry, createHostBindings())
    const plugin: SDFPlugin = {
      id: "built-in-collider",
      name: "BuiltInCollider",
      version: "0.1.0",
      activate: (ctx) => {
        ctx.registerPanel({ id: "canvas", label: "충돌", component: () => null })
      },
    }
    loadPlugins(registry, [plugin], ctx)
    expect(registry.getErrors("built-in-collider")).toEqual([
      { kind: "panel_id_conflict", message: expect.stringMatching(/canvas.*내장 패널 id와 충돌/), ts: expect.any(Number) },
    ])
  })
})
