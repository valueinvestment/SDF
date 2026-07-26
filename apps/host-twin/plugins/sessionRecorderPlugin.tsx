"use client"
import { useCallback, useRef, useState, type ChangeEvent, type DragEvent } from "react"
import type { PluginProps, SDFPlugin } from "@sdf/types"
import type * as echarts from "echarts"
import { BaseECharts } from "@/components/BaseECharts"
import { encode, type DecodedRecording } from "@/lib/sdfRecording"
import type { WorkerResponse } from "@/workers/sdfRecordingParser.worker"

interface FactoryStoreShape {
  machines: Record<string, { history: [number, number, number, number][] }>
}

export function SessionRecorderPanel(props: PluginProps) {
  const machines = props.useStoreSlice((s) => (s as FactoryStoreShape).machines)
  const [dragOver, setDragOver] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recording, setRecording] = useState<DecodedRecording | null>(null)
  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleDownload = useCallback(() => {
    const buffer = encode(machines)
    const blob = new Blob([buffer], { type: "application/octet-stream" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `session-${Date.now()}.sdfrec`
    a.click()
    URL.revokeObjectURL(url)
  }, [machines])

  const parseFile = useCallback((file: File) => {
    setLoading(true)
    setError(null)
    setRecording(null)
    file.arrayBuffer().then((buffer) => {
      const worker = new Worker(new URL("../workers/sdfRecordingParser.worker.ts", import.meta.url))
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        setLoading(false)
        if (e.data.ok && e.data.data) {
          setRecording(e.data.data)
          setSelectedMachineId(e.data.data.machines[0]?.id ?? null)
        } else {
          setError(e.data.error ?? "파싱 실패")
        }
        worker.terminate()
      }
      worker.postMessage(buffer, [buffer])
    })
  }, [])

  const handleFileDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) parseFile(file)
  }

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) parseFile(file)
  }

  const selectedMachine = recording?.machines.find((m) => m.id === selectedMachineId)

  const option: echarts.EChartsOption | null =
    recording && selectedMachine
      ? {
          backgroundColor: "transparent",
          animation: false,
          grid: { left: 36, right: 10, top: 18, bottom: 18 },
          xAxis: { type: "value", axisLabel: { fontSize: 9, color: "#6b7280" } },
          yAxis: { type: "value", axisLabel: { fontSize: 9, color: "#6b7280" } },
          series: recording.channels.map((name, i) => ({
            name,
            type: "line",
            data: selectedMachine.samples.map((s) => [s.tsOffsetMs, s.values[i]]),
            smooth: true,
            symbol: "none",
          })),
        }
      : null

  return (
    <div className="bg-gray-900 rounded-lg p-3 space-y-3">
      <p className="text-xs text-gray-400">예시 플러그인: 세션 레코더 (.sdfrec)</p>

      <button
        onClick={handleDownload}
        className="w-full py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 text-white text-xs font-medium"
      >
        현재 세션 다운로드
      </button>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleFileDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-3 text-center cursor-pointer transition-colors ${
          dragOver ? "border-emerald-400 bg-emerald-900/20" : "border-gray-600 hover:border-gray-500"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".sdfrec"
          onChange={handleFileSelect}
          className="hidden"
        />
        <p className="text-xs text-gray-400">.sdfrec 파일을 드래그하거나 클릭하여 업로드</p>
      </div>

      {loading && <p className="text-xs text-gray-500 text-center">파싱 중...</p>}
      {error && <p className="text-xs text-red-400 text-center">{error}</p>}

      {recording && (
        <div className="space-y-2">
          {recording.machines.length > 1 && (
            <select
              value={selectedMachineId ?? ""}
              onChange={(e) => setSelectedMachineId(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded text-xs text-white px-2 py-1"
            >
              {recording.machines.map((m) => (
                <option key={m.id} value={m.id}>{m.id}</option>
              ))}
            </select>
          )}
          {option && <BaseECharts option={option} notMerge={true} />}
        </div>
      )}
    </div>
  )
}

export const sessionRecorderPlugin: SDFPlugin = {
  id: "example-session-recorder",
  name: "Example: Session Recorder",
  version: "0.1.0",
  activate: (ctx) => {
    ctx.registerPanel({
      id: "example-session-recorder-panel",
      label: "예시: 세션 레코더",
      component: (props) => <SessionRecorderPanel {...props} />,
    })
  },
}
