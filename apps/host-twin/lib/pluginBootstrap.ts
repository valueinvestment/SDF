"use client"

import {
  PluginRegistry,
  createPluginContext,
  createPluginProps,
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

// Function values (store actions) can't survive structuredClone, so strip them
// first, then deep-clone what's left. This guarantees plugins receive a pure
// data snapshot that shares no object references with the live store — direct
// mutation of nested fields (e.g. `state.machines.M1.vibration = 0`) can no
// longer corrupt the real Zustand store.
function snapshotState(state: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(stripFunctions(state))
}

export function createHostBindings(): PluginContextBindings {
  return {
    getReadOnlyState: () =>
      snapshotState(useFactoryStore.getState() as unknown as Record<string, unknown>),
    subscribe: (listener) =>
      useFactoryStore.subscribe(() =>
        listener(snapshotState(useFactoryStore.getState() as unknown as Record<string, unknown>)),
      ),
    addRule: (rule) => useFactoryStore.getState().addRule(rule),
    addComputedMetric: (metric) => useFactoryStore.getState().addComputedMetric(metric),
    registerPanelPosition: (id, label, pos) =>
      useFactoryStore.getState().registerPluginPanel(id, label, pos),
  }
}

const hostBindings = createHostBindings()
const pluginContext = createPluginContext(pluginRegistry, hostBindings)
export const pluginProps = createPluginProps(hostBindings)

// React 18 StrictMode double-invokes effects in dev — guard so bootstrapPlugins()
// only runs once per page load (PluginRegistry.register() would otherwise throw
// on the second invocation for the same plugin id).
let bootstrapped = false

export function bootstrapPlugins(): void {
  if (bootstrapped) return
  bootstrapped = true
  loadPlugins(pluginRegistry, installedPlugins, pluginContext)
}
