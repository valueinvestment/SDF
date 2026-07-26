"use client"
import { useCallback, useRef, useState, type ChangeEvent, type DragEvent } from "react"
import { loadPluginFromURL, type PluginError, type PluginRegistry, type PluginSummary, type PanelRenderError } from "@sdf/plugin-runtime"
import type { PluginContext, PluginErrorEvent } from "@sdf/types"

const KIND_LABEL: Record<PluginError["kind"], string> = {
  register_conflict: "등록 충돌",
  panel_id_conflict: "패널 id 충돌",
  activate_failed: "활성화 실패",
}

type ActiveSummary = Extract<PluginSummary, { status: "active" }>
type RejectedSummary = Extract<PluginSummary, { status: "rejected" }>

function isActive(summary: PluginSummary): summary is ActiveSummary {
  return summary.status === "active"
}

function isRejected(summary: PluginSummary): summary is RejectedSummary {
  return summary.status === "rejected"
}

interface Snapshot {
  summaries: PluginSummary[]
  errors: Map<string, PluginError[]>
  renderErrors: Map<string, PanelRenderError[]>
}

function readSnapshot(registry: PluginRegistry): Snapshot {
  return {
    summaries: registry.list(),
    errors: registry.getAllErrors(),
    renderErrors: registry.getAllRenderErrors(),
  }
}

export function PluginInspectorPanel({
  registry,
  pluginContext,
  backendErrors = [],
}: {
  registry: PluginRegistry
  pluginContext: PluginContext
  backendErrors?: PluginErrorEvent[]
}) {
  const [snapshot, setSnapshot] = useState(() => readSnapshot(registry))
  const refresh = useCallback(() => setSnapshot(readSnapshot(registry)), [registry])
  const [dragOver, setDragOver] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const active = snapshot.summaries.filter(isActive)
  const rejected = snapshot.summaries.filter(isRejected)

  const handleFileUpload = useCallback(async (file: File) => {
    setUploadError(null)
    let url: string | null = null
    try {
      const text = await file.text()
      const blob = new Blob([text], { type: "text/javascript" })
      url = URL.createObjectURL(blob)
      await loadPluginFromURL(registry, url, pluginContext)
      refresh()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "플러그인 로드 실패")
    } finally {
      if (url) URL.revokeObjectURL(url)
    }
  }, [registry, pluginContext, refresh])

  const handleFileDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFileUpload(file)
  }

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFileUpload(file)
  }

  return (
    <div className="bg-gray-900 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">플러그인 인스펙터</h2>
        <button
          onClick={refresh}
          className="text-[10px] px-2 py-1 rounded border border-gray-700 text-gray-400 hover:border-gray-600"
        >
          새로고침
        </button>
      </div>

      {active.length === 0 && rejected.length === 0 && (
        <p className="text-xs text-gray-600">등록된 플러그인이 없습니다.</p>
      )}

      <div className="space-y-2">
        {active.map((plugin) => {
          const errors = snapshot.errors.get(plugin.id) ?? []
          return (
            <div key={plugin.id} className="border border-gray-800 rounded-lg p-3 space-y-1.5">
              <div className="flex items-baseline gap-2">
                <span className="text-gray-200 font-medium text-xs">{plugin.name}</span>
                <span className="text-gray-600 text-[10px] font-mono">
                  {plugin.id}@{plugin.version}
                </span>
              </div>
              {plugin.description && (
                <p className="text-gray-500 text-[11px]">{plugin.description}</p>
              )}
              {errors.map((err, i) => (
                <div key={i} className="flex items-start gap-2 text-[11px]">
                  <span className="px-1.5 py-0.5 rounded bg-fuchsia-900/40 text-fuchsia-300 text-[10px] font-medium flex-shrink-0">
                    {KIND_LABEL[err.kind]}
                  </span>
                  <span className="text-gray-500">{err.message}</span>
                </div>
              ))}
            </div>
          )
        })}

        {rejected.map((entry, i) => (
          <div key={i} className="border border-fuchsia-800/60 rounded-lg p-3 space-y-1">
            <div className="flex items-baseline gap-2">
              <span className="text-fuchsia-400 font-medium text-xs">{entry.id}</span>
              <span className="px-1.5 py-0.5 rounded bg-fuchsia-900/40 text-fuchsia-300 text-[10px] font-medium">
                등록 거부됨
              </span>
            </div>
            <p className="text-gray-500 text-[11px]">{entry.message}</p>
          </div>
        ))}
      </div>

      {snapshot.renderErrors.size > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">패널 렌더링 에러</h3>
          {Array.from(snapshot.renderErrors.entries()).map(([panelId, errors]) => (
            <div key={panelId} className="border border-gray-800 rounded-lg p-3 space-y-1.5">
              <span className="text-gray-400 text-[10px] font-mono">{panelId}</span>
              {errors.map((err, i) => (
                <div key={i} className="flex items-start gap-2 text-[11px]">
                  <span className="px-1.5 py-0.5 rounded bg-fuchsia-900/40 text-fuchsia-300 text-[10px] font-medium flex-shrink-0">
                    렌더링 실패
                  </span>
                  <span className="text-gray-500">{err.message}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {backendErrors.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">백엔드 에러</h3>
          {backendErrors.map((event, i) => (
            <div key={i} className="border border-gray-800 rounded-lg p-3 space-y-1.5">
              <div className="flex items-baseline gap-2">
                <span className="px-1.5 py-0.5 rounded bg-fuchsia-900/40 text-fuchsia-300 text-[10px] font-medium">
                  {event.source === "collector" ? "Collector" : "PipelineStage"}
                </span>
                <span className="text-gray-400 text-[10px] font-mono">{event.id}</span>
              </div>
              <p className="text-gray-500 text-[11px]">{event.message}</p>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1.5 border-t border-gray-800 pt-3">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">플러그인 업로드 (개발용)</h3>
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
            accept=".js"
            onChange={handleFileSelect}
            className="hidden"
          />
          <p className="text-xs text-gray-400">.js 파일을 드래그하거나 클릭하여 업로드</p>
        </div>
        <p className="text-[11px] text-gray-600">예시: examples/plugins/machine-counter-plugin.js를 업로드해보세요</p>
        {uploadError && <p className="text-xs text-red-400">{uploadError}</p>}
      </div>
    </div>
  )
}
