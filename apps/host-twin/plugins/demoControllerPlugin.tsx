"use client"
import type { PluginProps, SDFPlugin } from "@sdf/types"

interface FactoryStoreShape {
  demoMode: boolean
}

export function DemoControllerPanel(props: PluginProps) {
  const demoMode = props.useStoreSlice((s) => (s as FactoryStoreShape).demoMode)

  return (
    <div className="bg-gray-900 rounded-lg p-3 space-y-2">
      <p className="text-xs text-gray-400">
        {demoMode ? "데모 모드 실행 중 — 모킹 데이터를 표시합니다" : "실제 백엔드 연결 중"}
      </p>
      <button
        onClick={() => props.setDemoMode(!demoMode)}
        className={`w-full py-1.5 rounded-lg text-xs font-medium ${
          demoMode
            ? "bg-red-700 hover:bg-red-600 text-white"
            : "bg-blue-700 hover:bg-blue-600 text-white"
        }`}
      >
        {demoMode ? "데모 모드 종료" : "데모 모드 시작"}
      </button>
    </div>
  )
}

export const demoControllerPlugin: SDFPlugin = {
  id: "demo-controller",
  name: "Demo Controller",
  version: "0.1.0",
  activate: (ctx) => {
    ctx.registerPanel({
      id: "demo-controller-panel",
      label: "데모 컨트롤러",
      component: (props) => <DemoControllerPanel {...props} />,
    })
  },
}
