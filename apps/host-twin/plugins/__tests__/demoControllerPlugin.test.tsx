import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { createPluginProps } from "@sdf/plugin-runtime"
import { DemoControllerPanel } from "../demoControllerPlugin"

function makeFakeBindings(demoMode: boolean) {
  const state = { demoMode }
  return {
    getReadOnlyState: () => state,
    subscribe: () => () => {},
    addRule: () => {},
    addComputedMetric: () => {},
    registerPanelPosition: () => {},
    setDemoMode: vi.fn(),
  }
}

describe("DemoControllerPanel", () => {
  it("shows the 'start demo' state and label when demo mode is off", () => {
    const props = createPluginProps(makeFakeBindings(false))
    render(<DemoControllerPanel {...props} />)
    expect(screen.getByText("실제 백엔드 연결 중")).toBeInTheDocument()
    expect(screen.getByText("데모 모드 시작")).toBeInTheDocument()
  })

  it("shows the 'stop demo' state and label when demo mode is on", () => {
    const props = createPluginProps(makeFakeBindings(true))
    render(<DemoControllerPanel {...props} />)
    expect(screen.getByText("데모 모드 실행 중 — 모킹 데이터를 표시합니다")).toBeInTheDocument()
    expect(screen.getByText("데모 모드 종료")).toBeInTheDocument()
  })

  it("calls setDemoMode(true) when clicked while off", () => {
    const bindings = makeFakeBindings(false)
    const props = createPluginProps(bindings)
    render(<DemoControllerPanel {...props} />)
    fireEvent.click(screen.getByText("데모 모드 시작"))
    expect(bindings.setDemoMode).toHaveBeenCalledWith(true)
  })

  it("calls setDemoMode(false) when clicked while on", () => {
    const bindings = makeFakeBindings(true)
    const props = createPluginProps(bindings)
    render(<DemoControllerPanel {...props} />)
    fireEvent.click(screen.getByText("데모 모드 종료"))
    expect(bindings.setDemoMode).toHaveBeenCalledWith(false)
  })
})
