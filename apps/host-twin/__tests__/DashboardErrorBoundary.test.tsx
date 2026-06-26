import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { useState } from "react"
import { DashboardErrorBoundary } from "@sdf/ui"

// 룰 엔진 수식 평가 실패를 모사하는 컴포넌트
function Boom({ shouldThrow }: { shouldThrow: boolean }): JSX.Element {
  if (shouldThrow) throw new Error("수식 평가 실패: Unknown variable 'pressure'")
  return <div>정상 위젯</div>
}

describe("DashboardErrorBoundary (@sdf/ui)", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("renders children normally when no error", () => {
    render(
      <DashboardErrorBoundary label="룰 엔진">
        <Boom shouldThrow={false} />
      </DashboardErrorBoundary>,
    )
    expect(screen.getByText("정상 위젯")).toBeInTheDocument()
  })

  it("isolates a thrown error and shows the neon fallback view", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    render(
      <DashboardErrorBoundary label="룰 엔진">
        <Boom shouldThrow={true} />
      </DashboardErrorBoundary>,
    )
    expect(screen.getByText(/룰 엔진/)).toBeInTheDocument()
    expect(screen.getByText(/Check formula or plugin configuration/)).toBeInTheDocument()
    expect(screen.getByText(/Unknown variable/)).toBeInTheDocument()
  })

  it("keeps a sibling widget alive when one boundary catches (fault isolation)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    render(
      <div>
        <DashboardErrorBoundary label="차트">
          <Boom shouldThrow={true} />
        </DashboardErrorBoundary>
        <DashboardErrorBoundary label="3D 캔버스">
          <Boom shouldThrow={false} />
        </DashboardErrorBoundary>
      </div>,
    )
    expect(screen.getByText("정상 위젯")).toBeInTheDocument()
    expect(screen.getByText(/차트/)).toBeInTheDocument()
  })

  it("recovers when the retry button is clicked and the child no longer throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})

    function Wrapper(): JSX.Element {
      const [throwing, setThrowing] = useState(true)
      return (
        <div>
          <button onClick={() => setThrowing(false)}>fix</button>
          <DashboardErrorBoundary label="룰 엔진">
            <Boom shouldThrow={throwing} />
          </DashboardErrorBoundary>
        </div>
      )
    }

    render(<Wrapper />)
    expect(screen.getByText(/Check formula or plugin configuration/)).toBeInTheDocument()

    fireEvent.click(screen.getByText("fix"))
    fireEvent.click(screen.getByText("Retry"))

    expect(screen.getByText("정상 위젯")).toBeInTheDocument()
  })
})
