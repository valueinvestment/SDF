# Phase 5a — WS 스트림 모킹 데모 모드 설계

**상태:** 브레인스토밍 완료, 승인됨 (사용자 위임 검토, 2026-07-28)
**로드맵 참조:** `docs/superpowers/specs/2026-07-22-plugin-platform-roadmap-v2.md` Phase 5 섹션

## 스코프 분리

로드맵 문서의 Phase 5는 "WS 스트림 모킹 데모 모드"와 "드래그 인터랙션 룰 에디터 확장"이라는 서로 독립적인 두 서브시스템을 한 Phase로 묶고 있었다. Phase 3에서도 같은 상황을 브레인스토밍 중 발견해 분리한 전례가 있어, 이번에도 분리했다. 이 문서는 **Phase 5a (WS 스트림 모킹 데모 모드)** 만 다룬다. 룰 에디터 드래그 확장은 별도 Phase 5b로 이후 브레인스토밍한다.

## 목표

실제 백엔드 서버 없이 대시보드를 데모할 수 있는 명시적 "데모 모드" 스위치를 추가한다. 정적 호스팅(GitHub Pages/Vercel)만으로 OSS 프로젝트 데모를 돌릴 수 있게 하는 것이 실질적 동기다.

## 핵심 발견: 모킹 시뮬레이터가 이미 존재함

설계 착수 전 코드 탐색 중, `apps/host-twin/hooks/useSimulator.ts`가 이미 다음을 구현하고 있음을 확인했다:
- 사인파 + 가우시안 노이즈 기반 센서 데이터 생성
- 기계별 고장 주기 시뮬레이션 (`status: fault` 전이 포함)
- `simTimeScale` 배속 지원
- **WebSocket이 연결되어 있지 않을 때 자동으로 가동** (`useSimulator({ wsConnected })`, `page.tsx`에서 `wsConnected: wsStatus === "connected"`로 이미 연결됨)

즉 "실제 백엔드 없이 데모"라는 로드맵 목표는 이미 상당 부분 구현되어 있었다 — 로드맵 문서가 Phase 5를 계획한 시점 이후에 이 훅이 추가된 것으로 보인다. 이 발견에 따라 스코프를 **새 데이터 생성기를 만들지 않고, 기존 자동 폴백을 사용자가 명시적으로 켜고 끌 수 있는 스위치 + 그 스위치를 노출하는 플러그인 패널만 추가**하는 것으로 좁혔다. 로봇/에이전트 이벤트 모킹(`useSimulator`가 현재 커버하지 않는 부분)은 이번 스코프에서 제외한다.

## 아키텍처 & 데이터 흐름

```
[demoControllerPlugin 패널] "데모 모드 시작" 버튼 클릭
        │
        ▼
props.setDemoMode(true)   ← PluginProps에 신설되는 유일한 쓰기 메서드
        │
        ▼ (createPluginProps → bindings.setDemoMode →)
useFactoryStore.getState().setDemoMode(true)   ← 신규 스토어 필드+액션
        │
        ▼
page.tsx가 store를 구독:
  const demoMode = useFactoryStore((s) => s.demoMode)
  const { status: wsStatus } = useWebSocket(WS_URL, demoMode, ...)
        │                                            ↑ 신규 파라미터
        │  demoMode=true면 connect() 자체를 건너뛰고 status를 "demo"로 설정
        │  (기존 소켓이 열려 있었다면 닫음)
        ▼
  useSimulator({ wsConnected: wsStatus === "connected" })   ← 변경 없음!
        │  wsStatus가 "demo"이므로 wsConnected는 자동으로 false
        │  → useSimulator의 기존 "연결 안 됨 시 자동 가동" 로직이 그대로 발동
        ▼
  사인파+가우시안 노이즈 데이터가 2Hz 간격으로 applySnapshot() 호출 (기존 BASE_TICK_MS)
```

**핵심 설계 결정:**
- **`useSimulator.ts`는 한 줄도 수정하지 않는다.** "연결 안 됨" 상태를 데모 모드가 흉내 내는 것만으로 기존 자동 폴백 로직을 재사용한다.
- **실제 WS와 모킹 데이터가 동시에 store에 쓰이는 걸 막아야 한다** — `useWebSocket`이 `demoMode=true`일 때 `connect()` 자체를 하지 않도록(소켓을 열지 않음) 해서 두 데이터 소스의 경쟁을 원천 차단한다.
- **상태 배지에 `"demo"` 상태 추가**: 안 하면 데모 모드 중 기존 UI가 "✕ 연결 끊김"으로 표시되어 오작동처럼 보인다.
- **`PluginProps` 최초의 쓰기 기능**: 지금까지 모든 패널은 `useStoreSlice`로 읽기만 했다. `setDemoMode`는 좁고 목적 특화된 메서드 하나만 추가하며(범용 dispatch 아님), `PluginContextBindings`(현재 `getReadOnlyState`/`subscribe`/`addRule`/`addComputedMetric`/`registerPanelPosition` 5개, 전부 필수 필드)와 같은 패턴으로 필수 필드로 추가한다 — 선택적 필드로 만들어 기존 테스트 파일들을 안 건드리는 방법도 검토했으나, 기존 5개 필드가 전부 필수인 것과 일관성이 깨지고 소비자 코드에 `?.` 분기가 늘어나므로 채택하지 않았다.

## 파일 변경 사항

### `packages/types/src/index.ts` (수정)

```ts
export interface PluginProps {
  useStoreSlice: <T>(selector: (state: unknown) => T) => T
  /**
   * 데모 모드를 켜고 끕니다. 켜지면 호스트는 실제 WebSocket 연결을 시도하지
   * 않고, 이미 존재하는 프론트엔드 전용 모킹 시뮬레이터(useSimulator)가
   * 자동으로 가동됩니다 — 이 메서드는 그 상태를 명시적으로 요청하는 스위치일
   * 뿐, 데이터 생성 로직 자체는 갖고 있지 않습니다. PluginProps 최초의
   * 쓰기 기능이라 필요한 만큼만 좁게 노출합니다(범용 dispatch 아님).
   */
  setDemoMode: (enabled: boolean) => void
}
```

### `packages/plugin-runtime/src/context.ts` (수정)

```ts
export interface PluginContextBindings {
  getReadOnlyState: () => unknown
  subscribe: (listener: (state: unknown) => void) => () => void
  addRule: (rule: Omit<Rule, "id" | "lastTriggeredAt">) => void
  addComputedMetric: (metric: Omit<ComputedMetric, "id">) => void
  registerPanelPosition: (
    id: string,
    label: string,
    defaultPosition?: PluginPanel["defaultPosition"],
  ) => void
  setDemoMode: (enabled: boolean) => void
}

export function createPluginProps(bindings: PluginContextBindings): PluginProps {
  return {
    useStoreSlice: createUseStoreSlice(bindings.getReadOnlyState, bindings.subscribe),
    setDemoMode: bindings.setDemoMode,
  }
}
```

**연쇄 영향 (중요, 계획 단계에서 반드시 태스크로 다뤄야 함):** `PluginContextBindings`에 필수 필드를 추가하면, 이 타입의 객체를 직접 리터럴로 만드는 기존 테스트 파일들이 타입체크에 실패한다. 코드 탐색으로 확인한 영향 파일 6개:
- `apps/host-twin/plugins/__tests__/alertLogPlugin.test.tsx`
- `apps/host-twin/plugins/__tests__/sensorChartPlugin.test.tsx`
- `apps/host-twin/plugins/__tests__/sessionRecorderPlugin.test.tsx`
- `apps/host-twin/__tests__/PluginInspectorPanel.test.tsx`
- `packages/plugin-runtime/src/__tests__/context.test.ts`
- `packages/plugin-runtime/src/__tests__/loader.test.ts`

각 파일의 `makeBindings()`류 헬퍼에 `setDemoMode: vi.fn()` 한 줄만 추가하면 되는 기계적 변경이다(Phase 4에서 `PluginInspectorPanel`에 `pluginContext` prop을 추가했을 때 기존 테스트 9개를 기계적으로 고쳤던 것과 같은 패턴). 단, `context.test.ts`는 추가로:
- 8번 줄의 `fakeProps: PluginProps` 리터럴에도 `setDemoMode` 추가 필요
- `"exposes exactly the useStoreSlice key"` 테스트(86-89번 줄)를 `["setDemoMode", "useStoreSlice"]`로 갱신 필요
- `registerRule`↔`bindings.addRule` 위임을 검증하는 기존 테스트와 대칭되는, `setDemoMode`↔`bindings.setDemoMode` 위임을 검증하는 새 테스트 추가 권장

`pluginContextIntegration.test.ts`/`pluginBootstrap.test.ts`는 실제 `createHostBindings()`를 사용하므로(리터럴을 직접 안 만듦) 영향 없음 — `pluginBootstrap.ts`만 고치면 자동으로 통과한다.

### `apps/host-twin/store/factoryStore.ts` (수정)

```ts
// interface FactoryStore 안:
demoMode: boolean
setDemoMode: (enabled: boolean) => void

// 초기 상태/액션 정의부:
demoMode: false,
setDemoMode: (enabled) => set({ demoMode: enabled }),
```

### `apps/host-twin/hooks/useWebSocket.ts` (수정)

```ts
export type WsStatus = "connecting" | "connected" | "disconnected" | "error" | "demo"

export function useWebSocket(
  url: string,
  demoMode: boolean,
  robotPosRef?: React.MutableRefObject<RobotPositionRef>,
  machineGroupsRef?: React.MutableRefObject<MachineGroupRef>,
  updatePathLine?: (robotId: string, path: [number, number][]) => void,
  clearPathLine?: (robotId: string) => void,
  updateComponentFault?: (machineId: string, faults: Record<string, { severity: "warn" | "critical" }>) => void,
  updateRobotPath?: (robotId: string, waypoints: [number, number][]) => void,
) {
  // ...기존 ref/state 선언 그대로

  useEffect(() => {
    let active = true

    if (demoMode) {
      setStatus("demo")
      const ws = wsRef.current
      if (ws) { ws.close(); wsRef.current = null }
      return () => { active = false }
    }

    const connect = () => {
      // ...기존 connect 함수 본문 그대로, 한 글자도 안 바꿈
    }

    connect()

    const drain = () => {
      // ...기존 drain 함수 본문 그대로
    }

    rafRef.current = requestAnimationFrame(drain)

    return () => {
      // ...기존 cleanup 그대로
    }
  }, [url, demoMode])

  return { status }
}
```

`demoMode`를 `[url]`이었던 의존성 배열에 추가하는 것이 핵심 변경이다 — 이래야 토글할 때마다 이펙트가 재실행되어 연결/해제가 실제로 일어난다. `connect`/`drain`/기존 cleanup 로직은 전혀 손대지 않는다. React가 이펙트 재실행 시 이전 cleanup을 먼저 실행하므로, "실제 연결 중 → 데모 모드 켜짐" 전환 시 기존 cleanup이 `retryRef`/소켓을 정상적으로 정리한 뒤 새 이펙트가 `demoMode` 분기로 들어간다 — 별도의 특별 처리가 필요 없음을 코드 추적으로 확인했다.

### `apps/host-twin/app/page.tsx` (수정)

```ts
const demoMode = useFactoryStore((s) => s.demoMode)
const { status: wsStatus } = useWebSocket(
  WS_URL,
  demoMode,
  // ...기존 인자 순서 그대로 유지
)
useSimulator({ wsConnected: wsStatus === "connected" })  // 변경 없음
```

상태 배지:
```tsx
wsStatus === "connected"  ? "bg-green-900 text-green-400" :
wsStatus === "connecting" ? "bg-yellow-900 text-yellow-400" :
wsStatus === "demo"       ? "bg-purple-900 text-purple-400" :
wsStatus === "error"      ? "bg-red-900 text-red-400" :
// ...(기존 disconnected 폴백 그대로)

{wsStatus === "connected"  ? "● 연결됨" :
 wsStatus === "connecting" ? "○ 연결 중..." :
 wsStatus === "demo"       ? "🎬 데모 모드" :
 wsStatus === "error"      ? "✕ 오류" : "✕ 연결 끊김"}
```

### `apps/host-twin/lib/pluginBootstrap.ts` (수정)

`createHostBindings()`에 추가:
```ts
setDemoMode: (enabled) => useFactoryStore.getState().setDemoMode(enabled),
```

### `apps/host-twin/plugins/demoControllerPlugin.tsx` (신규)

```tsx
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
            ? "bg-red-900/60 hover:bg-red-900 text-red-300 border border-red-800"
            : "bg-purple-900/60 hover:bg-purple-900 text-purple-300 border border-purple-800"
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
```

### `apps/host-twin/lib/plugins.ts` (수정)

`demoControllerPlugin`을 기존 `installedPlugins` 배열에 추가.

## 테스트 계획

- **`apps/host-twin/store/factoryStore.test.ts`** (기존 파일에 케이스 추가): `demoMode` 기본값 `false`, `setDemoMode`가 토글하는지.
- **`apps/host-twin/plugins/__tests__/demoControllerPlugin.test.tsx`** (신규): `sessionRecorderPlugin.test.tsx`와 같은 패턴 — 가짜 bindings로 `createPluginProps` 생성 후 렌더, 버튼 클릭 시 `props.setDemoMode`(→ `bindings.setDemoMode`)가 올바른 인자로 호출되는지, `demoMode` 상태에 따라 버튼 라벨/스타일이 바뀌는지 확인.
- **`packages/plugin-runtime/src/__tests__/context.test.ts`** (기존 파일 수정, 위 "연쇄 영향" 절 참조): `makeBindings()`/`fakeProps`에 `setDemoMode` 추가, 키 목록 단언 갱신, `setDemoMode` 위임 테스트 신규 추가.
- **나머지 5개 파일** (`loader.test.ts`, `alertLogPlugin.test.tsx`, `sensorChartPlugin.test.tsx`, `sessionRecorderPlugin.test.tsx`, `PluginInspectorPanel.test.tsx`): 각자의 `makeBindings()`류 헬퍼에 `setDemoMode: vi.fn()` 한 줄씩 추가 — 기계적 변경, 동작 검증 내용 변화 없음.
- **`useWebSocket.ts`는 여전히 전용 테스트 없음** — 기존에도 없었던 컨벤션(thin glue) 유지. `demoMode` 분기는 코드 추적으로 정확성을 확인했고(위 아키텍처 절 참조), 실제 동작은 `pnpm dev`로 수동 확인한다(구현 단계 실측 필요 사항).
- **회귀 확인**: `pnpm test` 전체 스위트.

**구현 단계 실측 필요 사항**: `pnpm dev`로 실행 후 데모 컨트롤러 패널에서 "데모 모드 시작"을 눌러 (1) 상태 배지가 "🎬 데모 모드"로 바뀌는지, (2) 대시보드에 사인파 기반 데이터가 흐르기 시작하는지, (3) "데모 모드 종료"를 누르면 실제 WS 재연결을 시도하는지 확인한다. 자동 테스트로 커버되지 않는 부분이다(Phase 4의 브라우저 업로드 흐름과 같은 종류의 한계).

## 비목표

- 새 모킹 데이터 생성기 (기존 `useSimulator` 재사용)
- 로봇/에이전트 이벤트 모킹 (`useSimulator`가 현재 커버하지 않음, 이번 스코프 제외)
- 사전 녹화된 고정 페이로드 파일 재생 (브라우저 내 생성기로 확정)
- 룰 에디터 드래그 인터랙션 확장 (별도 Phase 5b)
- 범용 플러그인 쓰기 API/dispatch 메커니즘 (목적 특화된 `setDemoMode` 하나만 추가)

## 의존관계

Phase 0 패널 계약 필수(완료). 기존 `useSimulator`(별도 phase 없이 이미 구현됨) 재사용.
