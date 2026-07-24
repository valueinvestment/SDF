import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { createPluginProps } from "@sdf/plugin-runtime"
import { AlertLogPanel } from "../alertLogPlugin"

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
  }
}

describe("AlertLogPanel", () => {
  it("renders an empty state when there is no alert history", () => {
    const props = createPluginProps(makeFakeBindings({ alertHistory: [] }))
    render(<AlertLogPanel {...props} />)
    expect(screen.getByText("알림 없음")).toBeInTheDocument()
  })

  it("renders alert items once alertHistory is populated", () => {
    const props = createPluginProps(
      makeFakeBindings({
        alertHistory: [{ id: "a1", machineId: "M1", ts: Date.UTC(2026, 0, 1, 12, 0, 0) }],
      }),
    )
    render(<AlertLogPanel {...props} />)
    expect(screen.queryByText("알림 없음")).not.toBeInTheDocument()
    expect(screen.getByText("M1")).toBeInTheDocument()
  })
})
