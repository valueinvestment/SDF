"use client"
import { useMemo } from "react"
import type * as echarts from "echarts"
import { BaseECharts } from "@/components/BaseECharts"
import { useSensorChart } from "@/hooks/useSensorChart"

interface Props {
  machineId: string
  label?: string
}

const SERIES_CONFIG = [
  { name: "진동(Hz)", color: "#3b82f6", index: 1 },
  { name: "온도(°C)", color: "#f59e0b", index: 2 },
  { name: "전류(A)",  color: "#10b981", index: 3 },
]

export function SensorChart({ machineId, label }: Props) {
  const { history } = useSensorChart(machineId)
  const pts = history?.length ?? 0

  const option: echarts.EChartsOption = useMemo(() => ({
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
      data: SERIES_CONFIG.map((s) => s.name),
      top: 0,
      right: 8,
      textStyle: { fontSize: 9, color: "#9ca3af" },
      itemWidth: 10,
      itemHeight: 6,
    },
    series: SERIES_CONFIG.map((s) => ({
      name: s.name,
      type: "line" as const,
      data: history ? history.map((row) => [row[0], row[s.index]]) : [],
      smooth: true,
      symbol: "none",
      lineStyle: { color: s.color, width: 1.5 },
    })),
  }), [history])

  return (
    <div className="bg-gray-900 rounded-lg p-2">
      <p className="text-xs text-gray-400 mb-1">
        {label ?? machineId}
        <span className="ml-2 text-gray-600 font-mono">
          {pts > 0 ? `${pts}pts` : "대기 중..."}
        </span>
      </p>
      <BaseECharts option={option} notMerge={false} />
    </div>
  )
}
