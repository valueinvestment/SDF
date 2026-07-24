import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { createPluginProps } from "@sdf/plugin-runtime"
import { SensorChartPanel } from "../sensorChartPlugin"

vi.mock("@/components/BaseECharts", () => ({
  BaseECharts: () => <div data-testid="chart-mock" />,
}))

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

describe("SensorChartPanel", () => {
  it("renders an empty state when M1 has no history yet", () => {
    const props = createPluginProps(makeFakeBindings({ machines: { M1: { history: [] } } }))
    render(<SensorChartPanel {...props} />)
    expect(screen.getByText(/데이터 대기 중/)).toBeInTheDocument()
    expect(screen.queryByTestId("chart-mock")).not.toBeInTheDocument()
  })

  it("renders the chart once M1's history is populated", () => {
    const props = createPluginProps(
      makeFakeBindings({ machines: { M1: { history: [[1000, 50, 60, 10]] } } }),
    )
    render(<SensorChartPanel {...props} />)
    expect(screen.queryByText(/데이터 대기 중/)).not.toBeInTheDocument()
    expect(screen.getByTestId("chart-mock")).toBeInTheDocument()
  })
})
