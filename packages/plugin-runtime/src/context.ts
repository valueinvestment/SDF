import type { PluginContext, PluginPanel, Rule, ComputedMetric } from "@sdf/types"
import type { PluginRegistry } from "./registry"

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
      registry.registerPanelComponent(panel.id, panel.component)
      bindings.registerPanelPosition(panel.id, panel.label, panel.defaultPosition)
    },
    registerRule: (rule) => bindings.addRule(rule),
    registerMetric: (metric) => bindings.addComputedMetric(metric),
  }
}
