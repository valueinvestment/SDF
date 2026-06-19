"use client"
import { useFactoryStore } from "@/store/factoryStore"

export function AlertHistory() {
  const history = useFactoryStore((s) => s.alertHistory)

  if (!history.length) return null

  return (
    <div className="bg-gray-900 rounded-xl p-4 space-y-2">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">알람 내역</h2>
      <div className="divide-y divide-gray-800">
        {history.map((item) => (
          <div key={item.id} className="flex items-start gap-3 py-2 text-xs">
            <span className="text-yellow-500 mt-0.5">⚠</span>
            <div className="flex-1 min-w-0">
              <span className="text-gray-200 font-medium">기계 {item.machineId}</span>
              {item.result && (
                <span className="ml-2 text-gray-400">→ {item.result}</span>
              )}
              {!item.result && (
                <span className="ml-2 text-gray-600 animate-pulse">처리 중...</span>
              )}
            </div>
            <span className="text-gray-600 flex-shrink-0 tabular-nums">
              {new Date(item.ts).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
