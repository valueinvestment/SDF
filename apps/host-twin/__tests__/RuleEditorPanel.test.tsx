import { describe, it, expect, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { useFactoryStore } from "@/store/factoryStore"
import { RuleEditorPanel } from "@/components/RuleEditorPanel"

function makeDataTransfer(payload: Record<string, string> = {}) {
  const store = { ...payload }
  return {
    get types() { return Object.keys(store) },
    setData: (type: string, value: string) => { store[type] = value },
    getData: (type: string) => store[type] ?? "",
  }
}

beforeEach(() => {
  useFactoryStore.setState({
    rules: [],
    computedMetrics: [],
    placedEntities: [
      { id: "M1", type: "press", x: 0, z: 0, label: "프레스" },
      { id: "M2", type: "cnc", x: 1, z: 1, label: "CNC" },
      { id: "R1", type: "robot", x: 2, z: 2, label: "AMR" },
    ],
  })
})

function seedRule(patch: Partial<{ machineId: string | null }> = {}) {
  useFactoryStore.setState((s) => ({
    rules: [
      ...s.rules,
      {
        id: "rule-1",
        name: "고온 경보",
        condition: "temperature > 100",
        machineId: patch.machineId ?? null,
        actions: [],
        lastTriggeredAt: 0,
        cooldownMs: 10000,
        enabled: true,
      },
    ],
  }))
}

describe("RuleEditorPanel — machine chip list", () => {
  it("lists only non-robot placed entities as machine chips", () => {
    render(<RuleEditorPanel />)
    // 머신 칩은 "🏭 " 아이콘 접두사와 함께 렌더링된다(아래 Step 4 JSX 참조)
    expect(screen.getByText("🏭 프레스")).toBeInTheDocument()
    expect(screen.getByText("🏭 CNC")).toBeInTheDocument()
    expect(screen.queryByText("AMR")).not.toBeInTheDocument()
  })
})

describe("RuleEditorPanel — A: drag machine onto new-rule draft zone", () => {
  it("shows a target badge after dropping a machine chip onto the draft zone", () => {
    render(<RuleEditorPanel />)
    const chip = screen.getByText("🏭 프레스")
    const dropzone = screen.getByTestId("rule-draft-dropzone")
    const dataTransfer = makeDataTransfer({ "application/x-sdf-machine": JSON.stringify({ machineId: "M1", label: "프레스" }) })

    fireEvent.dragStart(chip, { dataTransfer })
    fireEvent.dragOver(dropzone, { dataTransfer })
    fireEvent.drop(dropzone, { dataTransfer })

    expect(screen.getByText("대상: 프레스")).toBeInTheDocument()
  })

  it("creates the rule with the dropped machineId instead of null", () => {
    render(<RuleEditorPanel />)
    const chip = screen.getByText("🏭 프레스")
    const dropzone = screen.getByTestId("rule-draft-dropzone")
    const dataTransfer = makeDataTransfer({ "application/x-sdf-machine": JSON.stringify({ machineId: "M1", label: "프레스" }) })

    fireEvent.dragStart(chip, { dataTransfer })
    fireEvent.dragOver(dropzone, { dataTransfer })
    fireEvent.drop(dropzone, { dataTransfer })

    fireEvent.change(screen.getByPlaceholderText("룰 이름 (e.g. 고온 경보)"), { target: { value: "고온 경보" } })
    // Task 6부터 조건 입력은 기본이 간단 모드이며 "temperature > 100"이 이미 조립되어 있으므로 별도 입력이 불필요하다
    fireEvent.click(screen.getByText("룰 추가"))

    expect(useFactoryStore.getState().rules[0].machineId).toBe("M1")
  })

  it("clears the target back to null (전체 대상) when the badge's clear button is clicked", () => {
    render(<RuleEditorPanel />)
    const chip = screen.getByText("🏭 프레스")
    const dropzone = screen.getByTestId("rule-draft-dropzone")
    const dataTransfer = makeDataTransfer({ "application/x-sdf-machine": JSON.stringify({ machineId: "M1", label: "프레스" }) })
    fireEvent.dragStart(chip, { dataTransfer })
    fireEvent.dragOver(dropzone, { dataTransfer })
    fireEvent.drop(dropzone, { dataTransfer })

    fireEvent.click(screen.getByTestId("rule-draft-target-clear"))

    expect(screen.queryByText("대상: 프레스")).not.toBeInTheDocument()
  })

  it("uses the actually-dragged chip's own machineId, not a hardcoded one", () => {
    render(<RuleEditorPanel />)
    const chip = screen.getByText("🏭 CNC")
    const dropzone = screen.getByTestId("rule-draft-dropzone")
    const dataTransfer = makeDataTransfer()

    fireEvent.dragStart(chip, { dataTransfer })
    fireEvent.dragOver(dropzone, { dataTransfer })
    fireEvent.drop(dropzone, { dataTransfer })

    expect(screen.getByText("대상: CNC")).toBeInTheDocument()
  })

  it("ignores a drop with an unrelated dataTransfer type", () => {
    render(<RuleEditorPanel />)
    const dropzone = screen.getByTestId("rule-draft-dropzone")
    const dataTransfer = makeDataTransfer({ "text/plain": "not a machine" })

    fireEvent.dragOver(dropzone, { dataTransfer })
    fireEvent.drop(dropzone, { dataTransfer })

    expect(screen.queryByText(/대상:/)).not.toBeInTheDocument()
  })
})

describe("RuleEditorPanel — C: drag a saved rule onto a machine chip", () => {
  it("calls updateRule with the dropped machineId", () => {
    seedRule()
    render(<RuleEditorPanel />)
    const ruleCard = screen.getByText("고온 경보")
    const chip = screen.getByText("🏭 CNC")
    const dataTransfer = makeDataTransfer({ "application/x-sdf-rule": JSON.stringify({ ruleId: "rule-1" }) })

    fireEvent.dragStart(ruleCard, { dataTransfer })
    fireEvent.dragOver(chip, { dataTransfer })
    fireEvent.drop(chip, { dataTransfer })

    expect(useFactoryStore.getState().rules[0].machineId).toBe("M2")
  })

  it("shows a scope badge on a rule card once scoped, and clears it back to null via the badge's clear button", () => {
    seedRule({ machineId: "M1" })
    render(<RuleEditorPanel />)

    expect(screen.getByTestId("rule-scope-badge-rule-1")).toBeInTheDocument()

    fireEvent.click(screen.getByTestId("rule-scope-clear-rule-1"))

    expect(useFactoryStore.getState().rules[0].machineId).toBeNull()
  })

  it("ignores a drop onto a machine chip with an unrelated dataTransfer type", () => {
    seedRule()
    render(<RuleEditorPanel />)
    const chip = screen.getByText("🏭 CNC")
    const dataTransfer = makeDataTransfer({ "application/x-sdf-machine": JSON.stringify({ machineId: "M2", label: "CNC" }) })

    fireEvent.dragOver(chip, { dataTransfer })
    fireEvent.drop(chip, { dataTransfer })

    expect(useFactoryStore.getState().rules[0].machineId).toBeNull()
  })
})

describe("RuleEditorPanel — B: simple condition builder mode", () => {
  it("defaults to simple mode with 'temperature > 100' pre-assembled", () => {
    render(<RuleEditorPanel />)
    expect(screen.getByDisplayValue("temperature")).toBeInTheDocument()
    expect(screen.getByDisplayValue("100")).toBeInTheDocument()
  })

  it("updates the assembled condition string when the variable dropdown changes", () => {
    render(<RuleEditorPanel />)
    fireEvent.change(screen.getByTestId("rule-simple-var"), { target: { value: "vibration" } })
    fireEvent.change(screen.getByPlaceholderText("룰 이름 (e.g. 고온 경보)"), { target: { value: "진동 경보" } })
    fireEvent.click(screen.getByText("룰 추가"))
    expect(useFactoryStore.getState().rules[0].condition).toBe("vibration > 100")
  })

  it("updates the assembled condition string when the operator dropdown changes", () => {
    render(<RuleEditorPanel />)
    fireEvent.change(screen.getByTestId("rule-simple-op"), { target: { value: "<" } })
    fireEvent.change(screen.getByPlaceholderText("룰 이름 (e.g. 고온 경보)"), { target: { value: "저온 경보" } })
    fireEvent.click(screen.getByText("룰 추가"))
    expect(useFactoryStore.getState().rules[0].condition).toBe("temperature < 100")
  })

  it("updates the assembled condition string when the threshold input changes, preserving decimals", () => {
    render(<RuleEditorPanel />)
    fireEvent.change(screen.getByTestId("rule-simple-threshold"), { target: { value: "98.6" } })
    fireEvent.change(screen.getByPlaceholderText("룰 이름 (e.g. 고온 경보)"), { target: { value: "체온 경보" } })
    fireEvent.click(screen.getByText("룰 추가"))
    expect(useFactoryStore.getState().rules[0].condition).toBe("temperature > 98.6")
  })

  it("includes computed metric names in the variable dropdown, scoped to the current draft target", () => {
    useFactoryStore.setState({
      computedMetrics: [
        { id: "heat_index", name: "열지수", formula: "(vibration+temperature)/2", color: "#fff", machineId: null },
      ],
    })
    render(<RuleEditorPanel />)
    const select = screen.getByTestId("rule-simple-var") as HTMLSelectElement
    const optionValues = Array.from(select.options).map((o) => o.value)
    expect(optionValues).toContain("heat_index")
  })

  it("switches to text mode and shows the assembled string as an editable free-text input", () => {
    render(<RuleEditorPanel />)
    fireEvent.click(screen.getByText("텍스트"))
    expect(screen.getByDisplayValue("temperature > 100")).toBeInTheDocument()
  })

  it("switching back to simple mode resets the simple fields to defaults", () => {
    render(<RuleEditorPanel />)
    fireEvent.click(screen.getByText("텍스트"))
    fireEvent.change(screen.getByDisplayValue("temperature > 100"), { target: { value: "vibration > 5 && weird syntax" } })
    fireEvent.click(screen.getByText("간단"))
    expect(screen.getByDisplayValue("temperature")).toBeInTheDocument()
    expect(screen.getByDisplayValue("100")).toBeInTheDocument()
  })

  it("does not show 'Unknown variable' error when a computed metric is selected in the dropdown", () => {
    useFactoryStore.setState({
      computedMetrics: [
        { id: "heat_index", name: "열지수", formula: "(vibration+temperature)/2", color: "#fff", machineId: null },
      ],
    })
    render(<RuleEditorPanel />)
    fireEvent.change(screen.getByTestId("rule-simple-var"), { target: { value: "heat_index" } })
    expect(screen.queryByText(/Unknown variable/)).not.toBeInTheDocument()
  })

  it("clicking the already-active 간단 tab does not reset an in-progress selection", () => {
    render(<RuleEditorPanel />)
    fireEvent.change(screen.getByTestId("rule-simple-var"), { target: { value: "vibration" } })
    fireEvent.change(screen.getByTestId("rule-simple-op"), { target: { value: "<" } })
    fireEvent.click(screen.getByText("간단"))
    expect(screen.getByDisplayValue("vibration")).toBeInTheDocument()
    expect(screen.getByDisplayValue("<")).toBeInTheDocument()
  })
})
