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
 * Isolates individual widgets so a runtime error in one panel
 * does not crash the 3D canvas or other widgets.
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
        <div className="absolute inset-0 pointer-events-none rounded-lg"
          style={{ boxShadow: "0 0 12px 2px rgba(217,70,239,0.35), inset 0 0 8px rgba(217,70,239,0.1)" }} />

        <div className="p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-fuchsia-400 text-base font-bold select-none">⚠</span>
            <span className="text-fuchsia-300 text-xs font-semibold tracking-wider uppercase">
              {this.props.label ?? "Widget"} Error
            </span>
          </div>

          <p className="text-gray-400 text-xs leading-relaxed">
            Check formula or plugin configuration.
          </p>

          {this.state.error && (
            <pre className="text-[10px] text-fuchsia-500/80 bg-gray-900 rounded p-2 overflow-x-auto max-h-20 font-mono whitespace-pre-wrap">
              {this.state.error}
            </pre>
          )}

          <button
            onClick={this.handleReset}
            className="self-start mt-1 text-[10px] px-2.5 py-1 rounded border border-fuchsia-700 text-fuchsia-400 hover:bg-fuchsia-900/30 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }
}
