import type { SDFPlugin } from "@sdf/types"

export class PluginRegistry {
  private plugins = new Map<string, SDFPlugin>()

  register(plugin: SDFPlugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`[PluginRegistry] plugin id already registered: ${plugin.id}`)
    }
    this.plugins.set(plugin.id, plugin)
  }

  unregister(id: string): void {
    this.plugins.delete(id)
  }

  has(id: string): boolean {
    return this.plugins.has(id)
  }
}
