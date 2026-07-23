import type { SDFPlugin, PluginContext } from "@sdf/types"
import type { PluginRegistry } from "./registry"

export function loadPlugins(
  registry: PluginRegistry,
  plugins: SDFPlugin[],
  ctx: PluginContext,
): void {
  for (const plugin of plugins) {
    try {
      registry.register(plugin)
      const result = plugin.activate(ctx)
      if (result instanceof Promise) {
        result.catch((err) => {
          console.error(`[loadPlugins] plugin "${plugin.id}" activate() rejected`, err)
        })
      }
    } catch (err) {
      console.error(`[loadPlugins] failed to activate plugin "${plugin.id}"`, err)
    }
  }
}
