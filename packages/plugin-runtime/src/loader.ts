import type { SDFPlugin, PluginContext } from "@sdf/types"
import type { PluginRegistry } from "./registry"
import { PluginPanelConflictError } from "./errors"

export function loadPlugins(
  registry: PluginRegistry,
  plugins: SDFPlugin[],
  ctx: PluginContext,
): void {
  for (const plugin of plugins) {
    try {
      registry.register(plugin)
    } catch (err) {
      console.error(`[loadPlugins] failed to register plugin "${plugin.id}"`, err)
      registry.recordRejected(plugin.id, err instanceof Error ? err.message : String(err))
      continue
    }

    try {
      const result = plugin.activate(ctx)
      if (result instanceof Promise) {
        result.catch((err) => recordActivateError(registry, plugin.id, err))
      }
    } catch (err) {
      recordActivateError(registry, plugin.id, err)
    }
  }
}

function recordActivateError(registry: PluginRegistry, pluginId: string, err: unknown): void {
  console.error(`[loadPlugins] plugin "${pluginId}" activate() failed`, err)
  const message = err instanceof Error ? err.message : String(err)
  const kind = err instanceof PluginPanelConflictError ? "panel_id_conflict" : "activate_failed"
  registry.recordError(pluginId, { kind, message, ts: Date.now() })
}
