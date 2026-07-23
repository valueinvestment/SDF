import type { PluginContext, PluginPanel, PluginProps, Rule, ComputedMetric } from "@sdf/types"
import type { PluginRegistry } from "./registry"
import { createUseStoreSlice } from "./useStoreSlice"

export interface PluginContextBindings {
  getReadOnlyState: () => unknown
  subscribe: (listener: (state: unknown) => void) => () => void
  addRule: (rule: Omit<Rule, "id" | "lastTriggeredAt">) => void
  addComputedMetric: (metric: Omit<ComputedMetric, "id">) => void
  registerPanelPosition: (
    id: string,
    label: string,
    defaultPosition?: PluginPanel["defaultPosition"],
  ) => void
}

export function createPluginContext(
  registry: PluginRegistry,
  bindings: PluginContextBindings,
): PluginContext {
  return {
    store: {
      getState: bindings.getReadOnlyState,
      subscribe: bindings.subscribe,
    },
    registerPanel: (panel: PluginPanel) => {
      // registerPanelPosition must run first: in the real host it throws on a
      // built-in-id collision (canvas/charts/agent/detail/rules/mes). Only once
      // that succeeds do we register the component in the plugin registry —
      // otherwise a rejected panel would still leave its component orphaned in
      // `registry`, ready to silently shadow a built-in panel's render output.
      bindings.registerPanelPosition(panel.id, panel.label, panel.defaultPosition)
      registry.registerPanelComponent(panel.id, panel.component)
    },
    registerRule: (rule) => bindings.addRule(rule),
    registerMetric: (metric) => bindings.addComputedMetric(metric),
  }
}

export function createPluginProps(bindings: PluginContextBindings): PluginProps {
  return {
    useStoreSlice: createUseStoreSlice(bindings.getReadOnlyState, bindings.subscribe),
  }
}
