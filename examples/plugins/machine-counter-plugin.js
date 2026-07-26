// SDF Digital Twin — 예시 플러그인 (런타임 업로드용)
// PluginInspectorPanel의 "플러그인 업로드" 영역에 이 파일을 드래그하면
// 빌드/재배포 없이 즉시 로드·활성화됩니다.
//
// 이 파일은 어떤 패키지도 import하지 않습니다 — 브라우저가 Blob URL을 통해
// 네이티브로 동적 import()하는 평범한 ES 모듈이라, 번들러가 해석해주는
// "react" 같은 bare specifier를 import할 수 없습니다. activate(ctx)로
// 전달되는 PluginContext와, 패널 컴포넌트가 받는 PluginProps만으로
// 동작해야 합니다.

export default {
  id: "example-machine-counter",
  name: "Example: Machine Counter",
  version: "0.1.0",
  activate(ctx) {
    ctx.registerPanel({
      id: "example-machine-counter-panel",
      label: "예시: 머신 카운터",
      component: (props) => {
        const machines = props.useStoreSlice((state) => state.machines)
        const count = machines ? Object.keys(machines).length : 0
        return `현재 등록된 머신 수: ${count}`
      },
    })
  },
}
