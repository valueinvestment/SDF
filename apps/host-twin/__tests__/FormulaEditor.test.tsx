import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { useFactoryStore } from "@/store/factoryStore"
import { FormulaEditor } from "@/components/FormulaEditor"

function resetStore() {
  useFactoryStore.setState({ computedMetrics: [] })
}

describe("FormulaEditor", () => {
  it("shows the base variable names in the hint text", () => {
    resetStore()
    render(<FormulaEditor machineId="M1" />)
    expect(screen.getByText(/vibration, temperature, current/)).toBeInTheDocument()
  })

  it("includes an existing global computed metric's id in the hint text", () => {
    resetStore()
    useFactoryStore.setState({
      computedMetrics: [
        { id: "heat_index", name: "열지수", formula: "(vibration+temperature)/2", color: "#06b6d4", machineId: null },
      ],
    })
    render(<FormulaEditor machineId="M1" />)
    expect(screen.getByText(/heat_index/)).toBeInTheDocument()
  })

  it("accepts a formula that references an existing computed metric instead of rejecting it as an unknown variable", () => {
    resetStore()
    useFactoryStore.setState({
      computedMetrics: [
        { id: "heat_index", name: "열지수", formula: "(vibration+temperature)/2", color: "#06b6d4", machineId: null },
      ],
    })
    render(<FormulaEditor machineId="M1" />)
    const formulaInput = screen.getByPlaceholderText("(vibration + temperature) / 2")
    fireEvent.change(formulaInput, { target: { value: "heat_index * 2" } })
    expect(screen.queryByText(/Unknown variable/)).not.toBeInTheDocument()
  })
})
