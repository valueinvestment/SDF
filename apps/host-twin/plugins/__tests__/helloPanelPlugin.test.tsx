import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { createPluginProps } from "@sdf/plugin-runtime"
import { HelloPanelPanel } from "../helloPanelPlugin"

function makeFakeBindings(initial: unknown) {
  const state = initial
  const listeners = new Set<(s: unknown) => void>()
  return {
    getReadOnlyState: () => state,
    subscribe: (listener: (s: unknown) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    addRule: () => {},
    addComputedMetric: () => {},
    registerPanelPosition: () => {},
    setDemoMode: () => {},
  }
}

describe("HelloPanelPanel", () => {
  it("renders the live machine count", () => {
    const props = createPluginProps(makeFakeBindings({ machines: { M1: {}, M2: {} }, demoMode: false }))
    render(<HelloPanelPanel {...props} />)
    expect(screen.getByText(/2/)).toBeInTheDocument()
    expect(screen.queryByText(/데모 모드/)).not.toBeInTheDocument()
  })

  it("shows the demo mode indicator when demoMode is true", () => {
    const props = createPluginProps(makeFakeBindings({ machines: {}, demoMode: true }))
    render(<HelloPanelPanel {...props} />)
    expect(screen.getByText(/데모 모드 실행 중/)).toBeInTheDocument()
  })
})
