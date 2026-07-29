import { describe, it, expect, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { useFactoryStore } from "@/store/factoryStore"
import { RuleEditorPanel } from "@/components/RuleEditorPanel"

function makeDataTransfer(payload: Record<string, string>) {
  const store = { ...payload }
  return {
    types: Object.keys(store),
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
    // 이 시점(Task 4)엔 조건 입력이 아직 Task 6 이전의 평범한 텍스트 input이라 직접 채워야 한다
    fireEvent.change(screen.getByPlaceholderText("temperature > 100"), { target: { value: "temperature > 100" } })
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

  it("ignores a drop with an unrelated dataTransfer type", () => {
    render(<RuleEditorPanel />)
    const dropzone = screen.getByTestId("rule-draft-dropzone")
    const dataTransfer = makeDataTransfer({ "text/plain": "not a machine" })

    fireEvent.dragOver(dropzone, { dataTransfer })
    fireEvent.drop(dropzone, { dataTransfer })

    expect(screen.queryByText(/대상:/)).not.toBeInTheDocument()
  })
})
