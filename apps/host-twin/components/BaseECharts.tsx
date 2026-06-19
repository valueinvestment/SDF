"use client"
import { useEffect, useRef } from "react"
import type { CSSProperties } from "react"
import * as echarts from "echarts"

interface BaseEChartsProps {
  option: echarts.EChartsOption | null
  style?: CSSProperties
  notMerge?: boolean
}

export function BaseECharts({
  option,
  style = { width: "100%", height: 120 },
  notMerge = true,
}: BaseEChartsProps) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    chartRef.current = echarts.init(el, "dark")
    const ro = new ResizeObserver(() => chartRef.current?.resize())
    ro.observe(el)
    return () => {
      ro.disconnect()
      chartRef.current?.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!chartRef.current || !option) return
    chartRef.current.setOption(option, { notMerge })
  }, [option, notMerge])

  return <div ref={ref} style={style} />
}
