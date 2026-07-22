"use client"

import {
  PluginRegistry,
  createPluginContext,
  loadPlugins,
  type PluginContextBindings,
} from "@sdf/plugin-runtime"
import { useFactoryStore } from "@/store/factoryStore"
import { installedPlugins } from "./plugins"

export const pluginRegistry = new PluginRegistry()

function stripFunctions(state: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(state)) {
    if (typeof value !== "function") result[key] = value
  }
  return result
}

export function createHostBindings(): PluginContextBindings {
  return {
    getReadOnlyState: () =>
      stripFunctions(useFactoryStore.getState() as unknown as Record<string, unknown>),
    subscribe: (listener) =>
      useFactoryStore.subscribe(() => listener(useFactoryStore.getState())),
    addRule: (rule) => useFactoryStore.getState().addRule(rule),
    addComputedMetric: (metric) => useFactoryStore.getState().addComputedMetric(metric),
    registerPanelPosition: (id, label, pos) =>
      useFactoryStore.getState().registerPluginPanel(id, label, pos),
  }
}

const pluginContext = createPluginContext(pluginRegistry, createHostBindings())

// React 18 StrictMode double-invokes effects in dev — guard so bootstrapPlugins()
// only runs once per page load (PluginRegistry.register() would otherwise throw
// on the second invocation for the same plugin id).
let bootstrapped = false

export function bootstrapPlugins(): void {
  if (bootstrapped) return
  bootstrapped = true
  loadPlugins(pluginRegistry, installedPlugins, pluginContext)
}
