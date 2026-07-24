# SDF 오픈소스 플러그인 플랫폼 — Phase 2: 시각화 플러그인 2종 + 공통 Props 규격

**Date:** 2026-07-23
**Status:** Approved (design), pending implementation plan

---

## 0. 배경

전체 9-Phase 로드맵은 `docs/superpowers/specs/2026-07-22-plugin-platform-roadmap-v2.md`에 있다. Phase 0(프런트엔드 플러그인 코어, `@sdf/plugin-runtime`)과 Phase 1(백엔드 Collector/PipelineStage)은 모두 구현 완료되어 `main`에 반영되어 있다 (Phase 0: PR #4 머지, Phase 1: PR #5 리뷰 대기이나 로컬 `main`에는 이미 반영됨). 이 문서는 로드맵의 Phase 2 절을 출발점으로 한 브레인스토밍 세션의 결과를 상세 설계로 확정한 것이다.

---

## 1. Phase 2 목표 / 비목표

**목표**
- Phase 0의 `PluginPanel` 계약을 실제로 사용하는 예시 플러그인 2개(2D 센서 차트, 위험 알림 로그)를 만든다.
- Phase 0이 존재만 확인하고 손대지 않았던 `PluginProps`를 확정한다 — 10Hz로 갱신되는 센서 데이터를 플러그인이 매 tick마다 전체 리렌더링하지 않도록 하는 "Render-Bypass" 요구사항을 만족시키는 선택적 구독 API로 재정의한다.
- `PluginPanel.component`가 이 새 `PluginProps`를 인자로 받도록 계약을 확장하고, Phase 0의 패널 렌더링 경로(`packages/plugin-runtime/src/registry.ts`)가 이를 실제로 전달하도록 수정한다.

**비목표 (Phase 2에서 하지 않음)**
- 기존 내장 컴포넌트 `apps/host-twin/components/SensorChart.tsx`, `AlertHistory.tsx`를 플러그인으로 전환하거나 `useStoreSlice`로 마이그레이션하는 것. 이들은 이미 `useFactoryStore(selector)`를 직접 사용해 동일한 Render-Bypass 효과를 갖고 있으므로 그대로 둔다.
- `PluginContext.store.subscribe`가 매 스토어 변경마다 `structuredClone`으로 전체 상태를 복사하는 비용을 최적화하는 것 — Phase 0에서 발견되고 이번 세션에서 재확인된 별도 백로그 항목(로드맵 문서 "백로그 — PluginContext.store.subscribe의 structuredClone 비용 최적화" 참조)이며, 실측 후 착수한다.
- Web Worker 기반 대용량 데이터 파싱 — Phase 7의 MDF 파서 예시가 이 패턴을 실전 검증한다.
- 서드파티 플러그인 스캐폴딩/인스펙터 (Phase 3).
- `packages/ui`에 새 프리미티브 컴포넌트를 추가하는 것 — 현재 `packages/ui`는 `DashboardErrorBoundary`만 export한다. 두 예시 플러그인은 기존 내장 컴포넌트와 동일하게 Tailwind 클래스를 직접 사용한다.

---

## 2. 아키텍처

### 2.1 `PluginProps` 재정의

`packages/types/src/index.ts`의 기존 `PluginProps`는 어디서도 사용되지 않는 죽은 스텁이다:

```typescript
// 기존 — 삭제 대상
export interface PluginProps {
  entityId: string | null
  machines: Record<string, MachineState>
  config: DashboardConfig
  onConfigChange: (patch: Partial<EntityConfig>) => void
}
```

`machines`를 통째로 prop으로 내려주는 구조라, 이 prop이 바뀔 때마다(=매 10Hz tick마다) 패널 컴포넌트 전체가 리렌더링된다 — Render-Bypass 요구사항과 정면으로 충돌한다. 아래로 교체한다:

```typescript
// packages/types/src/index.ts
export interface PluginProps {
  /**
   * 호스트 스토어에서 선택자로 슬라이스를 구독한다. 선택된 값이 실제로
   * 바뀔 때만 컴포넌트가 리렌더링된다 (React useSyncExternalStore 기반).
   * state는 PluginContext.store.getState()와 동일하게 unknown으로 타입된다
   * — plugin-runtime은 호스트(apps/host-twin)의 구체 스토어 타입에 의존하지
   * 않으므로, 플러그인 작성자가 알고 있는 형태로 직접 캐스팅해서 셀렉터를 작성한다.
   */
  useStoreSlice: <T>(selector: (state: unknown) => T) => T
}
```

`PluginContext`(활성화 시점 API)는 변경하지 않는다 — `useStoreSlice`는 `PluginProps`(렌더링 시점에 패널 컴포넌트가 받는 props)에만 존재한다. 이는 의도적인 구분이다: `PluginContext`는 `activate()` 안에서 한 번 호출되는 등록 API이고, React 훅은 컴포넌트 렌더링 중에만 호출될 수 있으므로 훅을 `PluginContext`에 두는 것은애초에 불가능하다.

### 2.2 `useStoreSlice` 구현

`packages/plugin-runtime`에 새 파일 `src/useStoreSlice.ts`를 추가한다:

```typescript
import { useSyncExternalStore, useRef, useCallback } from "react"

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false
    }
    return true
  }
  const aKeys = Object.keys(a as object)
  const bKeys = Object.keys(b as object)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if (!deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
      return false
    }
  }
  return true
}

export function createUseStoreSlice(
  getState: () => unknown,
  subscribe: (listener: (state: unknown) => void) => () => void,
) {
  return function useStoreSlice<T>(selector: (state: unknown) => T): T {
    const selectorRef = useRef(selector)
    selectorRef.current = selector
    const lastValueRef = useRef<{ value: T } | null>(null)

    const getSnapshot = useCallback(() => {
      const next = selectorRef.current(getState())
      if (lastValueRef.current && deepEqual(lastValueRef.current.value, next)) {
        return lastValueRef.current.value
      }
      lastValueRef.current = { value: next }
      return next
    }, [])

    const subscribeToStore = useCallback(
      (onStoreChange: () => void) => subscribe(() => onStoreChange()),
      [],
    )

    return useSyncExternalStore(subscribeToStore, getSnapshot)
  }
}
```

- `getState`/`subscribe`는 Phase 0이 이미 만든 `PluginContextBindings.getReadOnlyState`/`subscribe`를 그대로 재사용한다 — **`PluginContextBindings` 인터페이스와 `createHostBindings()`의 구현 내용은 변경하지 않는다.** (`pluginBootstrap.ts` 파일 자체는 §2.3에서 설명하는 `pluginProps` export 한 줄이 추가되지만, 이는 기존 바인딩을 감싸는 것일 뿐 바인딩 자체를 바꾸는 게 아니다.)
- `subscribe`는 여전히 스토어 전체 변경마다 (매 10Hz tick마다) 전체 상태를 `structuredClone`해서 리스너에 넘긴다 — 이 비용 자체는 그대로 남는다 (§1 비목표, 백로그 항목).
- `useStoreSlice`가 실제로 막는 것은 **React 리렌더링**이다: `getSnapshot`이 이전 선택 결과와 동일하면 이전 참조를 그대로 반환하므로, `useSyncExternalStore`는 선택된 슬라이스가 실제로 바뀌지 않는 한 컴포넌트를 리렌더링하지 않는다.
- **동등성 비교는 `Object.is`가 아니라 구조적(deep) 비교를 써야 한다 — 이는 설계 초안의 결함이었고, Task 2 구현 중 발견되어 수정되었다.** 이유: `bindings.getReadOnlyState`/`subscribe`(Phase 0, `apps/host-twin/lib/pluginBootstrap.ts`)는 스토어가 바뀔 때마다(=매 10Hz tick마다) **스토어 전체**를 `structuredClone`한다 — 특정 슬라이스만 바뀌어도 관련 없는 다른 모든 필드까지 포함해 트리 전체가 새로 복제된다. 즉 `s => s.machines["M1"].history` 같은 참조 반환형 선택자라도, M1의 데이터가 실제로는 안 바뀐 tick에서조차 매번 **다른 배열 참조**를 돌려받는다 — `Object.is`는 이 경우 항상 `false`를 반환해 리렌더링을 막지 못한다. 이 문제는 원시값(숫자/문자열/불리언)을 뽑는 선택자에는 영향이 없지만(값 비교이므로), 이번 Phase 2의 두 예시 플러그인이 실제로 쓰는 선택자(`history` 배열, `alertHistory` 배열)는 **정확히 이 영향을 받는 참조형 선택자**이므로, `Object.is`로는 Phase 2의 핵심 목표(Render-Bypass)가 두 예시 플러그인 모두에서 사실상 동작하지 않았을 것이다. `deepEqual`로 바꾸면 클론 경계를 넘나들어도 구조적으로 동일한 값은 올바르게 "변경 없음"으로 판정된다.
- `deepEqual`은 이 파일 안에서만 쓰는 비공개 헬퍼로, JSON 호환 데이터(배열/일반 객체/원시값 — `structuredClone`으로 복제 가능한 데이터는 전부 포함)를 재귀적으로 비교한다. 별도 패키지 의존성을 추가하지 않는다.

`createPluginContext()`가 `useStoreSlice`도 만들어 `PluginProps`를 구성할 수 있도록, `packages/plugin-runtime/src/context.ts`에 헬퍼를 추가한다:

```typescript
export function createPluginProps(bindings: PluginContextBindings): PluginProps {
  return {
    useStoreSlice: createUseStoreSlice(bindings.getReadOnlyState, bindings.subscribe),
  }
}
```

### 2.3 `PluginPanel.component` 시그니처 변경 + `PanelRenderer` 수정

```typescript
// packages/types/src/index.ts — PluginPanel
export interface PluginPanel {
  id: string
  label: string
  component: (props: PluginProps) => unknown   // 기존: () => unknown
  defaultPosition?: { x: number; y: number; w: number; h: number }
}
```

`packages/plugin-runtime/src/registry.ts`의 `PanelRenderer`가 `props`를 실제로 전달하도록 수정한다:

```typescript
function PanelRenderer({
  component,
  props,
}: {
  component: (props: PluginProps) => unknown
  props: PluginProps
}): ReactNode {
  return component(props) as ReactNode
}
```

`PluginRegistry.registerPanelComponent`/`getPanelComponents`도 `component`의 새 시그니처에 맞춰 타입을 갱신하고, `getPanelComponents()`가 `PanelRenderer`에 `props`를 넘기도록 수정한다. `getPanelComponents()`는 이제 `props: PluginProps` 파라미터를 받는다 — 렌더링 시점에 호스트가 `createPluginProps(bindings)` 결과를 넘겨준다.

`apps/host-twin/app/page.tsx`에서 `registry.getPanelComponents(pluginProps)` 형태로 호출부를 수정한다 (`pluginProps`는 `apps/host-twin/lib/pluginBootstrap.ts`가 `createPluginProps(createHostBindings())`로 미리 만들어 export).

### 2.4 예시 플러그인 2개

새 디렉터리 `apps/host-twin/plugins/`:

```
apps/host-twin/plugins/
├── sensorChartPlugin.tsx
└── alertLogPlugin.tsx
```

두 플러그인 모두 기존 `SensorChart.tsx`/`AlertHistory.tsx`를 이식(porting)하지 않고, 같은 주제를 다루는 최소 구현으로 새로 작성한다 — 목적이 "플러그인 API가 실사용에 충분한가"를 검증하는 것이지 기존 UI를 대체하는 것이 아니기 때문이다.

**`sensorChartPlugin.tsx`** — 특정 머신(M1으로 고정, 하드코딩)의 진동/온도/전류 히스토리를 ECharts 라인 차트로 표시:
```typescript
export const sensorChartPlugin: SDFPlugin = {
  id: "example-sensor-chart",
  name: "Example: Sensor Chart",
  version: "0.1.0",
  activate: (ctx) => {
    ctx.registerPanel({
      id: "example-sensor-chart-panel",
      label: "예시: 센서 차트 (M1)",
      component: (props) => <SensorChartPanel {...props} />,
    })
  },
}
```
`SensorChartPanel`은 `props.useStoreSlice((s) => (s as FactoryStoreShape).machines["M1"]?.history)`로 히스토리 배열만 구독하고, `BaseECharts`(기존 컴포넌트 재사용 — `apps/host-twin/components/BaseECharts.tsx`)로 렌더링한다. `FactoryStoreShape`는 이 플러그인 파일 내부에서만 쓰는 로컬 타입 캐스팅 헬퍼로, `apps/host-twin/store/factoryStore.ts`의 `FactoryStore` 타입 중 필요한 필드(`machines`)만 최소로 명시한다 — plugin-runtime과 달리 `apps/host-twin/plugins/`는 호스트 앱 내부이므로 실제 스토어 타입을 import해도 계약 위반이 아니지만, 여기서는 "서드파티 플러그인 작성자는 이 타입을 모른다"는 걸 보여주기 위해 일부러 로컬 최소 캐스팅 타입을 쓴다 (실제 서드파티 플러그인이라면 `unknown` 캐스팅 후 런타임 체크를 하거나, 별도로 배포되는 타입 패키지를 참조해야 함을 문서화).

**`alertLogPlugin.tsx`** — `alertHistory` 슬라이스를 구독해 최근 알림 목록을 표시:
```typescript
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
```
`AlertLogPanel`은 `props.useStoreSlice((s) => (s as FactoryStoreShape).alertHistory)`로 구독하고, 목록을 렌더링한다 (아이콘 + 머신 id + 시각 — `AlertHistory.tsx`와 비슷한 정보 밀도지만 별도 구현).

두 플러그인 모두 `apps/host-twin/lib/plugins.ts`의 `installedPlugins` 배열에 추가한다:
```typescript
export const installedPlugins: SDFPlugin[] = [sensorChartPlugin, alertLogPlugin]
```

---

## 3. 데이터 흐름 요약

```
앱 부팅 (변경 없음, Phase 0과 동일)
  └─ bootstrapPlugins() → registry.register(plugin) → plugin.activate(pluginContext)
       └─ ctx.registerPanel({ id, label, component })  // component는 이제 (props) => unknown

렌더링 시 (변경)
  pluginBootstrap.ts: export const pluginProps = createPluginProps(createHostBindings())
  page.tsx: panelContent = { ...builtInPanels, ...registry.getPanelComponents(pluginProps) }
  registry.getPanelComponents(props):
    각 등록된 component에 대해 <DashboardErrorBoundary><PanelRenderer component={component} props={props} /></DashboardErrorBoundary>

패널 내부 (신규)
  SensorChartPanel(props):
    history = props.useStoreSlice(s => s.machines["M1"]?.history)
    └─ useSyncExternalStore가 host의 subscribe(전체 스토어 변경마다 발화)를 구독
    └─ 매 발화 시 selector(getState()) 재계산, 이전 값과 Object.is 비교
    └─ history 배열 참조가 실제로 바뀐 tick에서만 컴포넌트 리렌더링
```

---

## 4. 에러 핸들링

- `useStoreSlice`의 selector가 예외를 던지면(예: 존재하지 않는 머신 id 접근) `useSyncExternalStore`의 `getSnapshot` 안에서 발생하므로 React 렌더링 예외로 처리되고, 기존 §2.5(Phase 0) `DashboardErrorBoundary`가 그대로 격리한다 — Phase 2에서 추가 방어 로직을 넣지 않는다.
- `PanelRenderer`가 `props`를 받지 못하는 경우(레지스트리 호출부 실수)는 타입 시스템이 컴파일 타임에 막는다 — `getPanelComponents(props: PluginProps)`가 필수 파라미터이므로.

---

## 5. 테스트 계획

`packages/plugin-runtime`에 vitest 유닛 테스트 추가:
- `createUseStoreSlice`가 반환한 훅이 selector 결과가 바뀌지 않으면 리렌더링을 유발하지 않음 (렌더 카운트로 검증 — `@testing-library/react`의 `render`/`act`로 store 변경 이벤트를 발생시키고 렌더 횟수 비교)
- selector 결과가 실제로 바뀌면 정상적으로 리렌더링됨
- `PanelRenderer`가 `component(props)`를 호출하며 `props`를 정확히 전달하는지
- `registerPanelComponent`/`getPanelComponents`의 시그니처 변경 이후 기존 Phase 0 테스트가 새 시그니처에 맞춰 통과하는지 (기존 테스트 파일 갱신)

`apps/host-twin`에는 두 예시 플러그인이 실제로 마운트되어 렌더링되는 통합 테스트를 추가한다 (초기 히스토리가 없을 때 빈 상태 렌더, 히스토리가 채워지면 차트 렌더).

---

## 6. 릴리즈

CONTRIBUTING.md 규칙대로, 구현 완료 후 `pnpm changeset`으로 `@sdf/plugin-runtime`(minor — `useStoreSlice` API 추가, `PluginPanel.component` 시그니처 변경은 아직 0.x이므로 breaking이어도 minor 처리)과 `@sdf/types`(patch — `PluginProps`/`PluginPanel` 타입 변경)의 변경 로그를 기록한다.

---

## 7. 영향받는 기존 파일

| 파일 | 변경 내용 |
|---|---|
| `packages/types/src/index.ts` | `PluginProps` 재정의(기존 죽은 스텁 삭제), `PluginPanel.component` 시그니처를 `(props: PluginProps) => unknown`으로 변경 |
| `packages/plugin-runtime/src/useStoreSlice.ts` | 신규 — `createUseStoreSlice()` |
| `packages/plugin-runtime/src/context.ts` | `createPluginProps()` 추가 |
| `packages/plugin-runtime/src/registry.ts` | `PanelRenderer`/`registerPanelComponent`/`getPanelComponents`가 `props: PluginProps`를 받아 전달하도록 수정 |
| `packages/plugin-runtime/src/index.ts` | `createUseStoreSlice`, `createPluginProps` export 추가 |
| `apps/host-twin/lib/pluginBootstrap.ts` | `pluginProps` export 추가 (`createPluginProps(createHostBindings())`) — `createHostBindings()` 자체는 변경 없음 |
| `apps/host-twin/app/page.tsx` | `registry.getPanelComponents()` 호출부에 `pluginProps` 인자 추가 |
| `apps/host-twin/lib/plugins.ts` | `installedPlugins` 배열에 두 예시 플러그인 추가 |
| `apps/host-twin/plugins/sensorChartPlugin.tsx` | 신규 |
| `apps/host-twin/plugins/alertLogPlugin.tsx` | 신규 |

`apps/host-twin/components/SensorChart.tsx`, `AlertHistory.tsx`, `apps/host-twin/store/factoryStore.ts`, `packages/plugin-runtime/src/loader.ts`, `PluginContext`/`PluginContextBindings`(활성화 시점 API)는 변경하지 않는다.
