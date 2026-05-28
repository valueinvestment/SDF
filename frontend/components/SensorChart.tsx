"use client"
import { useEffect, useRef } from "react"
import * as echarts from "echarts"
import { useFactoryStore } from "@/store/factoryStore"

interface Props {
  machineId: string
}

export function SensorChart({ machineId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)
  const lastUpdateRef = useRef(0)

  useEffect(() => {
    if (!containerRef.current) return
    chartRef.current = echarts.init(containerRef.current, "dark")
    chartRef.current.setOption({
      backgroundColor: "transparent",
      animation: false,
      grid: { left: 40, right: 10, top: 20, bottom: 20 },
      xAxis: { type: "time", splitLine: { show: false } },
      yAxis: { type: "value", min: 0, max: 250, splitLine: { lineStyle: { color: "#374151" } } },
      series: [{ type: "line", data: [], smooth: true, symbol: "none", lineStyle: { color: "#3b82f6", width: 1.5 } }],
    })

    return () => {
      chartRef.current?.dispose()
    }
  }, [])

  useEffect(() => {
    const unsub = useFactoryStore.subscribe(
      (state) => {
        const now = Date.now()
        if (now - lastUpdateRef.current < 250) return
        const history = state.machines[machineId]?.history
        if (!history) return
        lastUpdateRef.current = now
        chartRef.current?.setOption(
          { series: [{ data: history }] },
          { notMerge: false }
        )
      }
    )
    return unsub
  }, [machineId])

  return (
    <div className="bg-gray-900 rounded-lg p-2">
      <p className="text-xs text-gray-400 mb-1">{machineId} — Vibration (Hz)</p>
      <div ref={containerRef} style={{ width: "100%", height: 100 }} />
    </div>
  )
}
