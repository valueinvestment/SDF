"use client"
import { useMemo } from "react"
import * as echarts from "echarts"
import { BaseECharts } from "@/components/BaseECharts"
import { useMachineDetail } from "@/hooks/useMachineDetail"
import type { ComponentStatus } from "@/lib/types"

const STATUS_COLOR: Record<string, string> = {
  ok: "#10b981",
  warn: "#f59e0b",
  critical: "#ef4444",
}

const PART_LABELS: Record<string, string> = {
  body: "메인 하우징",
  motor: "구동부",
  actuator: "작동부",
  sensor_unit: "센서",
}

// Layer 2: View Assembly — maps components data to ECharts option
function WearBars({ components }: { components: Record<string, ComponentStatus> }) {
  const option = useMemo((): echarts.EChartsOption => {
    const parts = Object.entries(components)
    return {
      backgroundColor: "transparent",
      animation: false,
      grid: { left: 80, right: 40, top: 10, bottom: 10 },
      xAxis: {
        type: "value",
        max: 100,
        splitLine: { lineStyle: { color: "#374151" } },
      },
      yAxis: {
        type: "category",
        data: parts.map(([p]) => PART_LABELS[p] ?? p),
        axisLabel: { color: "#9ca3af", fontSize: 11 },
      },
      series: [{
        type: "bar",
        data: parts.map(([, v]) => ({
          value: v.wear,
          itemStyle: { color: STATUS_COLOR[v.status] ?? "#6b7280" },
        })),
        label: {
          show: true,
          position: "right",
          formatter: "{c}%",
          color: "#d1d5db",
          fontSize: 10,
        },
      }],
    }
  }, [components])

  return <BaseECharts option={option} style={{ width: "100%", height: 120 }} />
}

// Layer 2: View Assembly — maps grid data to ECharts option
function ThermalHeatmap({ grid }: { grid: number[][] }) {
  const option = useMemo((): echarts.EChartsOption | null => {
    if (!grid.length) return null
    const data: [number, number, number][] = []
    grid.forEach((row, r) => row.forEach((val, c) => data.push([c, r, val])))
    return {
      backgroundColor: "transparent",
      animation: false,
      grid: { left: 10, right: 60, top: 10, bottom: 10 },
      xAxis: {
        type: "category",
        data: ["0", "1", "2", "3"],
        splitArea: { show: true },
      },
      yAxis: {
        type: "category",
        data: ["0", "1", "2", "3"],
        splitArea: { show: true },
      },
      visualMap: {
        min: 0,
        max: 1,
        calculable: true,
        orient: "vertical",
        right: 0,
        inRange: { color: ["#1e3a5f", "#f59e0b", "#ef4444"] },
      },
      series: [{ type: "heatmap", data, label: { show: false } }],
    }
  }, [grid])

  return <BaseECharts option={option} style={{ width: "100%", height: 130 }} />
}

// Layer 2: View Assembly — composes hook data + sub-components
export function MachineDetailPanel({
  machineId,
  label,
}: {
  machineId: string
  label?: string
}) {
  const { detail, criticalParts } = useMachineDetail(machineId)

  if (!detail) {
    return (
      <div className="bg-gray-900 rounded-xl p-4 w-full text-gray-500 text-sm animate-pulse">
        데이터 로딩 중...
      </div>
    )
  }

  return (
    <div className="bg-gray-900 rounded-xl p-4 w-full space-y-3">
      <div>
        <p className="font-semibold text-gray-100">{label ?? machineId}</p>
        <p className="text-xs text-gray-400 flex items-center gap-2 mt-0.5">
          <span
            className={`w-2 h-2 rounded-full inline-block ${
              detail.operationRate > 50 ? "bg-green-400" : "bg-red-400"
            }`}
          />
          가동률 {detail.operationRate.toFixed(1)}%
        </p>
      </div>

      {criticalParts.length > 0 && (
        <div className="bg-red-900/40 border border-red-700 rounded p-2">
          <p className="text-xs text-red-300 font-medium">고장 감지</p>
          {criticalParts.map(({ part, description }) => (
            <p key={part} className="text-xs text-red-400">
              {PART_LABELS[part] ?? part}: {description}
            </p>
          ))}
        </div>
      )}

      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">부품 노후도</p>
        <WearBars components={detail.components} />
      </div>

      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">열분포 히트맵</p>
        <ThermalHeatmap grid={detail.thermalGrid} />
      </div>
    </div>
  )
}
