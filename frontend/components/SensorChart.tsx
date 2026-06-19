"use client"
import { useMemo, useRef, useState } from "react"
import type * as echarts from "echarts"
import { BaseECharts } from "@/components/BaseECharts"
import { DashboardErrorBoundary } from "@/components/DashboardErrorBoundary"
import { FormulaEditor } from "@/components/FormulaEditor"
import { useSensorChart } from "@/hooks/useSensorChart"
import { useFactoryStore } from "@/store/factoryStore"
import { evaluateFormula } from "@/lib/formulaEngine"
import type { ComputedMetric } from "@/lib/types"

interface Props {
  machineId: string
  label?: string
}

const BASE_SERIES = [
  { name: "진동(Hz)", color: "#3b82f6", index: 1 },
  { name: "온도(°C)", color: "#f59e0b", index: 2 },
  { name: "전류(A)",  color: "#10b981", index: 3 },
]

function metricsEqual(a: ComputedMetric[], b: ComputedMetric[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].formula !== b[i].formula || a[i].color !== b[i].color || a[i].name !== b[i].name) return false
  }
  return true
}

function SensorChartInner({ machineId, label }: Props) {
  const { history } = useSensorChart(machineId)
  const prevMetricsRef = useRef<ComputedMetric[]>([])
  const computedMetrics = useFactoryStore((s) => {
    const filtered = s.computedMetrics.filter((m) => m.machineId === null || m.machineId === machineId)
    if (metricsEqual(prevMetricsRef.current, filtered)) return prevMetricsRef.current
    prevMetricsRef.current = filtered
    return filtered
  })
  const [showFormula, setShowFormula] = useState(false)
  const pts = history?.length ?? 0

  const option: echarts.EChartsOption = useMemo(() => {
    const baseSeries = BASE_SERIES.map((s) => ({
      name: s.name,
      type: "line" as const,
      data: history ? history.map((row) => [row[0], row[s.index]]) : [],
      smooth: true,
      symbol: "none",
      lineStyle: { color: s.color, width: 1.5 },
    }))

    // 커스텀 지표 시리즈 계산
    const customSeries = computedMetrics.map((cm) => ({
      name: cm.name,
      type: "line" as const,
      data: history
        ? history.map((row) => {
            const vars = { vibration: row[1], temperature: row[2], current: row[3] }
            const result = evaluateFormula(cm.formula, vars)
            return [row[0], result.ok ? result.value : null]
          })
        : [],
      smooth: true,
      symbol: "none",
      lineStyle: { color: cm.color, width: 1.5, type: "dashed" as const },
    }))

    return {
      backgroundColor: "transparent",
      animation: false,
      grid: { left: 36, right: 10, top: 18, bottom: 18 },
      xAxis: {
        type: "time" as const,
        splitLine: { show: false },
        axisLabel: { fontSize: 9, color: "#6b7280" },
      },
      yAxis: {
        type: "value" as const,
        splitLine: { lineStyle: { color: "#1f2937" } },
        axisLabel: { fontSize: 9, color: "#6b7280" },
      },
      legend: {
        data: [...BASE_SERIES.map((s) => s.name), ...computedMetrics.map((m) => m.name)],
        top: 0,
        right: 8,
        textStyle: { fontSize: 9, color: "#9ca3af" },
        itemWidth: 10,
        itemHeight: 6,
      },
      series: [...baseSeries, ...customSeries],
    }
  }, [history, computedMetrics])

  return (
    <div className="bg-gray-900 rounded-lg p-2">
      <div className="flex items-center mb-1 gap-2">
        <p className="text-xs text-gray-400 flex-1">
          {label ?? machineId}
          <span className="ml-2 text-gray-600 font-mono">
            {pts > 0 ? `${pts}pts` : "대기 중..."}
          </span>
        </p>
        <button
          onClick={() => setShowFormula((v) => !v)}
          className="text-[10px] px-1.5 py-0.5 rounded border border-cyan-800 text-cyan-500 hover:bg-cyan-900/30 transition-colors"
        >
          {showFormula ? "닫기" : "∑ 수식"}
        </button>
      </div>
      <BaseECharts option={option} notMerge={false} />
      {showFormula && (
        <div className="mt-2 pt-2 border-t border-gray-800">
          <FormulaEditor machineId={machineId} label={label} />
        </div>
      )}
    </div>
  )
}

export function SensorChart({ machineId, label }: Props) {
  return (
    <DashboardErrorBoundary label={`SensorChart(${label ?? machineId})`}>
      <SensorChartInner machineId={machineId} label={label} />
    </DashboardErrorBoundary>
  )
}
