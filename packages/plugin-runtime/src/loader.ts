import type { SDFPlugin, PluginContext } from "@sdf/types"
import type { PluginRegistry } from "./registry"
import { PluginPanelConflictError } from "./errors"

export function loadPlugins(
  registry: PluginRegistry,
  plugins: SDFPlugin[],
  ctx: PluginContext,
): void {
  for (const plugin of plugins) {
    if (!registerPlugin(registry, plugin)) continue
    activateAndRecord(registry, plugin, ctx)
  }
}

export async function loadPluginFromURL(
  registry: PluginRegistry,
  url: string,
  ctx: PluginContext,
): Promise<void> {
  const module = await import(/* webpackIgnore: true */ url)
  const plugin = module.default
  assertPluginShape(plugin)
  if (!registerPlugin(registry, plugin)) return
  activateAndRecord(registry, plugin, ctx)
}

function registerPlugin(registry: PluginRegistry, plugin: SDFPlugin): boolean {
  try {
    registry.register(plugin)
    return true
  } catch (err) {
    console.error(`[loadPlugins] failed to register plugin "${plugin.id}"`, err)
    registry.recordRejected(plugin.id, err instanceof Error ? err.message : String(err))
    return false
  }
}

function activateAndRecord(registry: PluginRegistry, plugin: SDFPlugin, ctx: PluginContext): void {
  try {
    const result = plugin.activate(ctx)
    if (result instanceof Promise) {
      result.catch((err) => recordActivateError(registry, plugin.id, err))
    }
  } catch (err) {
    recordActivateError(registry, plugin.id, err)
  }
}

function recordActivateError(registry: PluginRegistry, pluginId: string, err: unknown): void {
  console.error(`[loadPlugins] plugin "${pluginId}" activate() failed`, err)
  const message = err instanceof Error ? err.message : String(err)
  const kind = err instanceof PluginPanelConflictError ? "panel_id_conflict" : "activate_failed"
  registry.recordError(pluginId, { kind, message, ts: Date.now() })
}

function assertPluginShape(plugin: unknown): asserts plugin is SDFPlugin {
  if (
    !plugin ||
    typeof (plugin as SDFPlugin).id !== "string" ||
    typeof (plugin as SDFPlugin).name !== "string" ||
    typeof (plugin as SDFPlugin).version !== "string" ||
    typeof (plugin as SDFPlugin).activate !== "function"
  ) {
    throw new Error("업로드된 파일이 유효한 SDFPlugin을 default export하지 않습니다")
  }
}
