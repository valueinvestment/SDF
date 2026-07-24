"use client"
import type { AlertHistoryItem, PluginProps, SDFPlugin } from "@sdf/types"

interface FactoryStoreShape {
  alertHistory: AlertHistoryItem[]
}

export function AlertLogPanel(props: PluginProps) {
  const alertHistory = props.useStoreSlice((s) => (s as FactoryStoreShape).alertHistory)

  if (!alertHistory || alertHistory.length === 0) {
    return (
      <div className="bg-gray-900 rounded-lg p-4 text-xs text-gray-600 text-center">
        알림 없음
      </div>
    )
  }

  return (
    <div className="bg-gray-900 rounded-lg p-3 space-y-1">
      <p className="text-xs text-gray-400 mb-1">예시 플러그인: 위험 알림 로그</p>
      {alertHistory.map((item) => (
        <div key={item.id} className="flex items-center gap-2 text-xs">
          <span className="text-yellow-500">⚠</span>
          <span className="text-gray-200">{item.machineId}</span>
          <span className="text-gray-600 ml-auto tabular-nums">
            {new Date(item.ts).toLocaleTimeString("ko-KR", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
        </div>
      ))}
    </div>
  )
}

export const alertLogPlugin: SDFPlugin = {
  id: "example-alert-log",
  name: "Example: Alert Log",
  version: "0.1.0",
  activate: (ctx) => {
    ctx.registerPanel({
      id: "example-alert-log-panel",
      label: "예시: 위험 알림 로그",
      component: (props) => <AlertLogPanel {...props} />,
    })
  },
}
