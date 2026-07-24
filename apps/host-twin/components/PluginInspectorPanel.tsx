"use client"
import { useCallback, useState } from "react"
import type { PluginError, PluginRegistry, PluginSummary } from "@sdf/plugin-runtime"

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
}

function readSnapshot(registry: PluginRegistry): Snapshot {
  return { summaries: registry.list(), errors: registry.getAllErrors() }
}

export function PluginInspectorPanel({ registry }: { registry: PluginRegistry }) {
  const [snapshot, setSnapshot] = useState(() => readSnapshot(registry))
  const refresh = useCallback(() => setSnapshot(readSnapshot(registry)), [registry])

  const active = snapshot.summaries.filter(isActive)
  const rejected = snapshot.summaries.filter(isRejected)

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
    </div>
  )
}
