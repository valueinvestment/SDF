"use client"
import { useFactoryStore } from "@/store/factoryStore"
import type { AgentEvent } from "@sdf/types"

const AGENT_LABELS: Record<string, string> = {
  A: "Agent A — Diagnostic",
  B: "Agent B — Routing",
  C: "Agent C — Decision",
}

function AgentRow({ event }: { event: AgentEvent }) {
  const statusColor =
    event.status === "complete" ? "text-green-400"
    : event.status === "running" ? "text-yellow-400 animate-pulse"
    : "text-red-400"

  return (
    <div className="border border-gray-700 rounded-lg p-3 space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-200">{AGENT_LABELS[event.agentId]}</span>
        <span className={`text-xs font-mono ${statusColor}`}>{event.status}</span>
      </div>
      {event.summary && (
        <p className="text-xs text-gray-400 leading-relaxed">{event.summary}</p>
      )}
    </div>
  )
}

export function AgentPanel() {
  const events = useFactoryStore((s) => s.agentEvents)
  const dispatch = useFactoryStore((s) => s.dispatchCommand)

  if (events.length === 0) {
    return (
      <div className="bg-gray-900 rounded-lg p-4 text-gray-500 text-sm">
        Agents idle — waiting for anomaly detection...
      </div>
    )
  }

  return (
    <div className="bg-gray-900 rounded-lg p-4 space-y-3">
      <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Agent Chain</h2>
      <div className="space-y-2">
        {events.slice(-9).map((e, i) => <AgentRow key={i} event={e} />)}
      </div>
      {dispatch && (
        <div className="mt-3 border border-blue-800 rounded-lg p-3 bg-blue-950/40">
          <p className="text-xs text-blue-300 font-medium">Dispatch Active</p>
          <p className="text-xs text-blue-400 mt-1">
            {dispatch.robotId} → {dispatch.targetMachineId} · ETA {dispatch.estimatedArrival.toFixed(0)}s
          </p>
        </div>
      )}
    </div>
  )
}
