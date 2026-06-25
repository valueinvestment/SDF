import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { useState } from "react"
import { DashboardErrorBoundary } from "@/components/DashboardErrorBoundary"

// 룰 엔진 수식 평가 실패를 모사하는 컴포넌트
function Boom({ shouldThrow }: { shouldThrow: boolean }): JSX.Element {
  if (shouldThrow) throw new Error("수식 평가 실패: Unknown variable 'pressure'")
  return <div>정상 위젯</div>
}

describe("DashboardErrorBoundary", () => {
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
    // 폴백 UI: "{label} 오류" + 에러 상세
    expect(screen.getByText(/룰 엔진/)).toBeInTheDocument()
    expect(screen.getByText(/수식 또는 플러그인 설정을 확인해주세요/)).toBeInTheDocument()
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
    // 한 패널이 크래시해도 형제 패널은 정상 렌더
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
    expect(screen.getByText(/수식 또는 플러그인 설정을 확인해주세요/)).toBeInTheDocument()

    // 외부 상태를 고친 뒤 재시도
    fireEvent.click(screen.getByText("fix"))
    fireEvent.click(screen.getByText("재시도"))

    expect(screen.getByText("정상 위젯")).toBeInTheDocument()
  })
})
