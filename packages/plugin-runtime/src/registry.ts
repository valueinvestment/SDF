import { createElement, type ReactNode } from "react"
import { DashboardErrorBoundary } from "@sdf/ui"
import type { SDFPlugin, PluginProps } from "@sdf/types"
import { PluginPanelConflictError } from "./errors"

export type PluginErrorKind = "register_conflict" | "panel_id_conflict" | "activate_failed"

export interface PluginError {
  kind: PluginErrorKind
  message: string
  ts: number
}

export type PluginSummary =
  | { status: "active"; id: string; name: string; version: string; description?: string }
  | { status: "rejected"; id: string; message: string; ts: number }

function PanelRenderer({
  component,
  props,
}: {
  component: (props: PluginProps) => unknown
  props: PluginProps
}): ReactNode {
  return component(props) as ReactNode
}

export class PluginRegistry {
  private plugins = new Map<string, SDFPlugin>()
  private panelComponents = new Map<string, (props: PluginProps) => unknown>()
  private errors = new Map<string, PluginError[]>()
  private rejected: { id: string; message: string; ts: number }[] = []

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

  registerPanelComponent(id: string, component: (props: PluginProps) => unknown): void {
    if (this.panelComponents.has(id)) {
      throw new PluginPanelConflictError(`[PluginRegistry] panel id already registered: ${id}`)
    }
    this.panelComponents.set(id, component)
  }

  getPanelComponents(props: PluginProps): Record<string, ReactNode> {
    const result: Record<string, ReactNode> = {}
    for (const [id, component] of this.panelComponents.entries()) {
      result[id] = createElement(DashboardErrorBoundary, {
        label: id,
        children: createElement(PanelRenderer, { component, props }),
      })
    }
    return result
  }

  recordRejected(id: string, message: string): void {
    this.rejected.push({ id, message, ts: Date.now() })
  }

  recordError(pluginId: string, error: PluginError): void {
    const list = this.errors.get(pluginId) ?? []
    list.push(error)
    this.errors.set(pluginId, list)
  }

  getErrors(id: string): PluginError[] {
    return this.errors.get(id) ?? []
  }

  getAllErrors(): Map<string, PluginError[]> {
    return new Map(this.errors)
  }

  list(): PluginSummary[] {
    const active: PluginSummary[] = Array.from(this.plugins.values()).map((plugin) => ({
      status: "active",
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
    }))
    const rejected: PluginSummary[] = this.rejected.map((r) => ({ status: "rejected", ...r }))
    return [...active, ...rejected]
  }
}
