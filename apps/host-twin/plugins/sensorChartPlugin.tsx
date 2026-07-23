"use client"
import type { PluginProps, SDFPlugin } from "@sdf/types"
import type * as echarts from "echarts"
import { BaseECharts } from "@/components/BaseECharts"

const MACHINE_ID = "M1"

interface FactoryStoreShape {
  machines: Record<string, { history: [number, number, number, number][] }>
}

export function SensorChartPanel(props: PluginProps) {
  const history = props.useStoreSlice(
    (s) => (s as FactoryStoreShape).machines[MACHINE_ID]?.history,
  )

  if (!history || history.length === 0) {
    return (
      <div className="bg-gray-900 rounded-lg p-4 text-xs text-gray-600 text-center">
        {MACHINE_ID} 데이터 대기 중...
      </div>
    )
  }

  const option: echarts.EChartsOption = {
    backgroundColor: "transparent",
    animation: false,
    grid: { left: 36, right: 10, top: 18, bottom: 18 },
    xAxis: {
      type: "time",
      splitLine: { show: false },
      axisLabel: { fontSize: 9, color: "#6b7280" },
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: "#1f2937" } },
      axisLabel: { fontSize: 9, color: "#6b7280" },
    },
    series: [
      {
        name: "진동(Hz)",
        type: "line",
        data: history.map((row) => [row[0], row[1]]),
        smooth: true,
        symbol: "none",
        lineStyle: { color: "#3b82f6", width: 1.5 },
      },
      {
        name: "온도(°C)",
        type: "line",
        data: history.map((row) => [row[0], row[2]]),
        smooth: true,
        symbol: "none",
        lineStyle: { color: "#f59e0b", width: 1.5 },
      },
      {
        name: "전류(A)",
        type: "line",
        data: history.map((row) => [row[0], row[3]]),
        smooth: true,
        symbol: "none",
        lineStyle: { color: "#10b981", width: 1.5 },
      },
    ],
  }

  return (
    <div className="bg-gray-900 rounded-lg p-2">
      <p className="text-xs text-gray-400 mb-1">예시 플러그인: {MACHINE_ID} 센서 차트</p>
      <BaseECharts option={option} notMerge={false} />
    </div>
  )
}

export const sensorChartPlugin: SDFPlugin = {
  id: "example-sensor-chart",
  name: "Example: Sensor Chart",
  version: "0.1.0",
  activate: (ctx) => {
    ctx.registerPanel({
      id: "example-sensor-chart-panel",
      label: "예시: 센서 차트 (M1)",
      component: (props) => <SensorChartPanel {...props} />,
    })
  },
}
