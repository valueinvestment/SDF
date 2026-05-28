"use client"
import { useFactoryStore } from "@/store/factoryStore"

export function AlertBanner() {
  const alert = useFactoryStore((s) => s.activeAlert)
  if (!alert) return null

  return (
    <div className="bg-red-900/80 border border-red-500 rounded-lg px-4 py-3 flex items-center gap-3">
      <span className="text-red-400 text-lg">⚠</span>
      <div>
        <p className="font-semibold text-red-200">Anomaly Detected</p>
        <p className="text-sm text-red-300">Machine {alert.machineId} — Agent chain initiated</p>
      </div>
    </div>
  )
}
