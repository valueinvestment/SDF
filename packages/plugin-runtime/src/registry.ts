import { createElement, type ReactNode } from "react"
import { DashboardErrorBoundary } from "@sdf/ui"
import type { SDFPlugin, PluginProps } from "@sdf/types"

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
      throw new Error(`[PluginRegistry] panel id already registered: ${id}`)
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
}
