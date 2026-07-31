"use client"
import type { PluginProps, SDFPlugin } from "@sdf/types"

// `pnpm create-plugin hello-panel`로 생성된 스캐폴드를 그대로 채운 학습용 최소 예시.
// 프론트엔드 "정적 등록" 경로(HOW_TO_RUN.md 1단계)를 보여주기 위한 것으로, 별도의
// 훅이나 store 접근 없이 PluginProps.useStoreSlice 화이트리스트 API 하나만으로
// 동작한다 — 새 플러그인을 만들 때 복사해서 시작하기 좋은 가장 단순한 형태.
export function HelloPanelPanel(props: PluginProps) {
  const machineCount = props.useStoreSlice((s) => Object.keys((s as { machines: Record<string, unknown> }).machines).length)
  const demoMode = props.useStoreSlice((s) => (s as { demoMode: boolean }).demoMode)

  return (
    <div className="bg-gray-900 rounded-lg p-3">
      <p className="text-xs text-gray-400 mb-1">플러그인: HelloPanel (예시)</p>
      <p className="text-sm text-gray-200">
        현재 배치된 머신 <span className="font-semibold">{machineCount}</span>대
        {demoMode ? " · 데모 모드 실행 중" : ""}
      </p>
    </div>
  )
}

export const helloPanelPlugin: SDFPlugin = {
  id: "hello-panel",
  name: "HelloPanel",
  version: "0.1.0",
  activate: (ctx) => {
    ctx.registerPanel({
      id: "hello-panel-panel",
      label: "HelloPanel",
      component: (props) => <HelloPanelPanel {...props} />,
    })
  },
}
