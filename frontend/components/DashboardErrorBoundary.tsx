"use client"
import { Component, type ReactNode } from "react"

interface Props {
  children: ReactNode
  label?: string
}

interface State {
  hasError: boolean
  error: string | null
}

/**
 * DashboardErrorBoundary
 *
 * 개별 위젯(SensorChart, MachineDetailPanel 내부 영역)을 격리한다.
 * 런타임 오류가 발생해도 3D 캔버스와 다른 위젯은 계속 동작한다.
 */
export class DashboardErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error: error.message }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[DashboardErrorBoundary]", error, info.componentStack)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="relative rounded-lg overflow-hidden border border-fuchsia-700/60 bg-gray-950">
        {/* 네온 글로우 테두리 애니메이션 */}
        <div className="absolute inset-0 pointer-events-none rounded-lg"
          style={{ boxShadow: "0 0 12px 2px rgba(217,70,239,0.35), inset 0 0 8px rgba(217,70,239,0.1)" }} />

        <div className="p-4 flex flex-col gap-2">
          {/* 아이콘 + 타이틀 */}
          <div className="flex items-center gap-2">
            <span className="text-fuchsia-400 text-base font-bold select-none">⚠</span>
            <span className="text-fuchsia-300 text-xs font-semibold tracking-wider uppercase">
              {this.props.label ?? "위젯"} 오류
            </span>
          </div>

          {/* 안내 메시지 */}
          <p className="text-gray-400 text-xs leading-relaxed">
            수식 또는 플러그인 설정을 확인해주세요.
          </p>

          {/* 에러 상세 (토글) */}
          {this.state.error && (
            <pre className="text-[10px] text-fuchsia-500/80 bg-gray-900 rounded p-2 overflow-x-auto max-h-20 font-mono whitespace-pre-wrap">
              {this.state.error}
            </pre>
          )}

          {/* 재시도 버튼 */}
          <button
            onClick={this.handleReset}
            className="self-start mt-1 text-[10px] px-2.5 py-1 rounded border border-fuchsia-700 text-fuchsia-400 hover:bg-fuchsia-900/30 transition-colors"
          >
            재시도
          </button>
        </div>
      </div>
    )
  }
}
