# SDF 오픈소스 플러그인 플랫폼 — Phase 0: 플러그인 코어 계약 + 레지스트리

**Date:** 2026-07-22
**Status:** Approved (design), pending implementation plan

---

## 0. 배경 및 전체 로드맵

SDF Digital Twin을 오픈소스 플러그인 플랫폼으로 전환하기 위한 작업을 9개 Phase + 1개 병행 트랙 + 1개 백로그로 분해했다. 각 Phase는 독립적인 서브프로젝트로, 별도의 스펙 → 구현 계획 → 구현 사이클을 거친다. 이 문서는 **Phase 0**만을 상세 설계한다. 나머지 Phase는 아래 로드맵 표로만 기록하고, 착수 시점에 별도 브레인스토밍 세션을 거친다.

### 전체 로드맵

| Phase | 내용 | 실행 위치 | 비고 |
|---|---|---|---|
| **0** | **프런트엔드 플러그인 코어 계약 + 레지스트리** | frontend | 이 문서의 대상. 정적 등록, API는 동적 로딩 대비 설계 |
| 1 | 데이터 수집·처리 파이프라인 (파이프라인 패턴) | backend | 백엔드 플러그인 계약도 Phase 0와 동일 원칙(정적 등록 + 동적 대비 API)으로 설계 |
| 2 | 시각화 플러그인 2종(2D 차트, 위험 알림 로그) + 공통 Props 규격 | frontend | Render-Bypass SDK(Zustand 선택적 구독 + Worker 파싱) 요구사항을 설계 시점에 흡수 |
| 3 | 플러그인 보일러플레이트 생성기(`npx create-sdf-plugin`) + 플러그인 인스펙터(스키마 검증 UI) | tooling/frontend | |
| 4 | 프런트엔드 런타임 동적 주입 샌드박스 (재빌드 없이 `.js` 업로드) | frontend | Phase 0의 `registry.register()`에 fetch/`import()` 로더만 추가하는 구조 |
| 4.5 | 백엔드 플러그인 동적 로딩 | backend | Phase 1의 백엔드 계약에 `importlib` 기반 동적 모듈 로더 + 프로세스/격리 전략 추가. Phase 1 완료 후 착수 |
| 5 | WebSocket 스트림 모킹 데모 모드(드래그로 규칙 정의) + 플러그인 확장 | frontend | Phase 0 패널 계약 재사용 |
| 6 | ErrorBoundary 기반 플러그인 모니터링 대시보드 | frontend | Phase 0의 자동 ErrorBoundary 래핑을 기반으로 에러 목록/상세를 노출 |
| 7 | 예시 플러그인 실전 구현 (엔드투엔드 검증) | full-stack | Web Worker 기반 초대용량 바이너리(MDF/DAT) 파서를 "데이터 수집 플러그인" 예시로 흡수 |
| 8 | `README.md` / `HOW_TO_RUN.md` / `CONTRIBUTING.md` 갱신 | docs | Phase 0~7 전체 완료 후 |
| 9 | 이력서 어필 문서 (프로젝트 전체 이력 분석) | docs | Phase 0~8 전체 완료 후. git log + 코드 분석 기반으로, 항목별 "왜 필요했는가 / 안 했으면 어떤 문제 / 개발 후 무엇이 개선됐는가" 정리. 이번 플러그인 작업뿐 아니라 기존 3계층 렌더링, No-Code Builder Extensions 등 프로젝트 전체 엔지니어링 결정 포함 |
| 병행 | WebGL/Canvas 렌더링 회귀 테스트 자동화 (스냅샷 비교) | tooling | Phase 0~1과 동시 진행 — 이후 Phase들의 회귀 안전망 |
| 백로그 | Quadtree 기반 Fleet 시각화 최적화 | frontend | 일정 없음. 엔티티 수 제한이 실제로 늘어나는 요청이 들어올 때 착수 |

---

## 1. Phase 0 목표 / 비목표

**목표**
- `packages/types`에 이미 정의돼 있으나 어디서도 사용되지 않는 `SDFPlugin` / `PluginContext` / `PluginPanel` / `PluginProps` 계약을 실제로 동작시킨다.
- 플러그인이 (1) 대시보드 패널 등록 (2) 룰 등록 (3) 계산 지표 등록을 할 수 있는 최소 기능 레지스트리를 구현한다.
- 플러그인 코드에서 발생하는 런타임 오류가 호스트 앱(3D 캔버스 등)에 전파되지 않도록 자동으로 격리한다.
- Phase 4(런타임 동적 주입)가 나중에 API를 바꾸지 않고 얹을 수 있는 구조로 설계한다.

**비목표 (Phase 0에서 하지 않음)**
- 재빌드 없는 동적 `.js` 로딩 (Phase 4)
- 백엔드 파이프라인 플러그인 (Phase 1)
- 시각화 플러그인 공통 Props의 최종 확정 (Phase 2에서 결정 — Phase 0은 `PluginProps` 계약이 이미 존재함만 인지하고 건드리지 않음)
- 기존 6개 내장 패널(canvas/charts/agent/detail/rules/mes)을 플러그인으로 재작성하는 것

---

## 2. 아키텍처

### 2.1 패키지 구조

```
packages/plugin-runtime/
├── src/
│   ├── registry.ts    # PluginRegistry 클래스
│   ├── context.ts      # createPluginContext(bindings) → PluginContext
│   ├── loader.ts        # loadPlugins(plugins: SDFPlugin[], ctx) — 정적 순회 헬퍼
│   └── index.ts
├── package.json         # @sdf/plugin-runtime — depends on @sdf/types, @sdf/ui (peer: react)
└── tsconfig.json
```

새 워크스페이스 패키지로 분리한다 (Phase 4의 동적 로더, 향후 서드파티 플러그인 작성자가 `@sdf/plugin-runtime`만 import하면 되도록). `packages/core-sdk`(수식 엔진, 시뮬레이터 유틸)와는 관심사가 달라 통합하지 않는다.

### 2.2 PluginRegistry

```typescript
class PluginRegistry {
  private plugins = new Map<string, SDFPlugin>()
  private panelComponents = new Map<string, () => ReactNode>()

  register(plugin: SDFPlugin): void   // id 중복 시 에러 throw
  unregister(id: string): void
  registerPanelComponent(id: string, component: () => ReactNode): void
  getPanelComponents(): Record<string, ReactNode>  // 각 컴포넌트는 DashboardErrorBoundary로 자동 래핑됨
}
```

`register()`는 Phase 0의 정적 로더와 Phase 4의 동적 로더가 **공유하는 단일 진입점**이다. Phase 0은 `loadPlugins()`라는 얇은 래퍼로 이 메서드를 정적 배열에 대해 순회 호출하고, Phase 4는 나중에 `loadPluginFromURL(url, ctx)`라는 새 진입점을 추가해 같은 `register()`를 호출한다. 레지스트리의 공개 API는 Phase 4 도입 시점에도 변경되지 않는다.

### 2.3 PluginContext — 화이트리스트 접근

```typescript
function createPluginContext(bindings: PluginContextBindings): PluginContext {
  return {
    store: {
      getState: bindings.getReadOnlyState,   // setter 함수를 제외한 상태 스냅샷만
      subscribe: bindings.subscribe,
    },
    registerPanel: (panel) => {
      registry.registerPanelComponent(panel.id, panel.component)
      bindings.registerPanelPosition(panel.id, panel.label, panel.defaultPosition)
    },
    registerRule: (rule) => bindings.addRule(rule),
    registerMetric: (metric) => bindings.addComputedMetric(metric),
  }
}
```

`PluginContextBindings`는 `packages/plugin-runtime`이 정의하는 인터페이스이며, 실제 구현(Zustand 스토어에 대한 바인딩)은 `apps/host-twin` 쪽에서 주입한다. **`packages/plugin-runtime`은 `apps/host-twin`에 의존하지 않는다** — 호스트 앱이 어떤 상태 관리 라이브러리를 쓰든 바인딩 객체만 맞추면 재사용 가능하다.

화이트리스트 외 액션(`removeEntity`, `setDashboardConfig` 등)은 절대 노출하지 않는다. `getReadOnlyState`는 `useFactoryStore.getState()` 결과에서 함수 타입 값을 전부 제외한 순수 데이터 스냅샷을 반환한다.

### 2.4 패널 확장 — 최소 침습 방식

현재 `LayoutPanelId`(`packages/types`)는 닫힌 유니온(`"canvas"|"charts"|"agent"|"detail"|"rules"|"mes"`)이고, `apps/host-twin/app/page.tsx`의 `panelContent: Record<LayoutPanelId, ReactNode>`도 이 유니온에 고정되어 있다.

**변경 사항 (최소 범위):**
1. `LayoutPanelId`를 `string`으로 하위 호환 widening. 기존 6개 리터럴 값은 그대로 유효한 `string`이므로 기존 코드는 변경 없이 컴파운드.
2. `apps/host-twin/store/factoryStore.ts`에 새 액션 `registerPluginPanel(id, label, defaultPosition?)` 추가 — `layoutConfig.panels` 배열에 해당 `id`가 없으면, 그리드 맨 아래(기존 패널들의 `y+h` 최댓값)에 기본 크기(`w:1, h:3`)로 새 `LayoutPanel` 항목을 append. 이미 있으면 아무 것도 하지 않음(멱등 — 핫리로드 시 중복 방지).
3. `apps/host-twin/app/page.tsx`의 `panelContent`를 기존 6개 리터럴 매핑 객체와 `registry.getPanelComponents()`를 머지한 값으로 변경.

`LayoutGrid`(`components/LayoutManager.tsx`), `DEFAULT_LAYOUT`, 기존 6개 패널의 렌더링 스위치는 **변경하지 않는다.** 플러그인 패널은 기존 드래그/리사이즈/숨기기/`exportConfig`·`importConfig` 직렬화 경로를 그대로 상속받는다 (동일한 `layoutConfig.panels` 배열에 들어가므로).

### 2.5 에러 격리

`registry.getPanelComponents()`가 반환하는 각 컴포넌트는 **레지스트리 내부에서 자동으로** `@sdf/ui`의 `DashboardErrorBoundary`로 감싸진다. 플러그인 작성자는 직접 에러 바운더리를 신경 쓸 필요가 없다.

> **참고 (범위 외):** `DashboardErrorBoundary`가 현재 `packages/ui/src/DashboardErrorBoundary.tsx`와 `apps/host-twin/components/DashboardErrorBoundary.tsx`에 완전히 동일한 내용으로 중복 존재한다. Phase 0에서는 `@sdf/plugin-runtime`이 `@sdf/ui`의 버전만 import하도록 하고, 기존 앱 코드(`SensorChart` 등)가 쓰는 로컬 중복 파일은 건드리지 않는다 (관련 없는 리팩터링을 피하기 위함). 정리가 필요하면 별도 이슈로 분리한다.

### 2.6 등록 흐름 (정적)

```typescript
// apps/host-twin/lib/plugins.ts — 사용자가 편집하는 유일한 진입점
import type { SDFPlugin } from "@sdf/types"
export const installedPlugins: SDFPlugin[] = []
```

```typescript
// apps/host-twin/lib/pluginBootstrap.ts
import { PluginRegistry, createPluginContext, loadPlugins } from "@sdf/plugin-runtime"
import { installedPlugins } from "./plugins"
import { useFactoryStore } from "@/store/factoryStore"

export const registry = new PluginRegistry()
const ctx = createPluginContext({
  getReadOnlyState: () => stripFunctions(useFactoryStore.getState()),
  subscribe: useFactoryStore.subscribe,
  addRule: useFactoryStore.getState().addRule,
  addComputedMetric: useFactoryStore.getState().addComputedMetric,
  registerPanelPosition: (id, label, pos) =>
    useFactoryStore.getState().registerPluginPanel(id, label, pos),
})

export function bootstrapPlugins() {
  loadPlugins(registry, installedPlugins, ctx)
}
```

앱 루트(`app/layout.tsx` 또는 `page.tsx`)에서 마운트 시 1회 `bootstrapPlugins()` 호출.

---

## 3. 데이터 흐름 요약

```
앱 부팅
  └─ bootstrapPlugins()
       └─ installedPlugins 배열 순회
            └─ registry.register(plugin)
            └─ plugin.activate(pluginContext)
                 ├─ ctx.registerPanel(panel)
                 │    ├─ registry.registerPanelComponent(id, ErrorBoundary로 래핑된 component)
                 │    └─ store.registerPluginPanel(id, label, pos)  → layoutConfig.panels에 append
                 ├─ ctx.registerRule(rule)   → store.addRule(rule)
                 └─ ctx.registerMetric(metric) → store.addComputedMetric(metric)

렌더링 시
  page.tsx: panelContent = { ...builtInPanels, ...registry.getPanelComponents() }
  LayoutGrid: layoutConfig.panels 순서대로 panelContent[panel.id] 렌더
```

---

## 4. 에러 핸들링

- `PluginRegistry.register()`는 동일 `id`가 이미 등록돼 있으면 즉시 throw한다 — 개발 중 실수를 조기에 드러내기 위함(플러그인 개수가 적은 정적 등록 단계이므로 throw가 조용한 무시보다 안전).
- `plugin.activate()`가 예외를 던지면 `bootstrapPlugins()`가 해당 플러그인만 건너뛰고 `console.error`로 기록한다 — 플러그인 하나의 활성화 실패가 나머지 플러그인이나 호스트 앱 부팅을 막지 않는다.
- 패널 렌더링 중 오류는 §2.5의 자동 `DashboardErrorBoundary`가 격리한다.
- `registerRule`/`registerMetric`은 기존 `addRule`/`addComputedMetric` 자체의 검증 로직(있다면)을 그대로 통과한다 — Phase 0에서 별도 검증을 추가하지 않는다.

---

## 5. 테스트 계획

`packages/plugin-runtime`에 vitest 유닛 테스트:
- `PluginRegistry.register()` 중복 id 거부
- `createPluginContext()`가 반환한 객체에 화이트리스트 4개 키(`store`, `registerPanel`, `registerRule`, `registerMetric`) 외의 속성이 없음을 검증
- `getPanelComponents()`가 반환하는 각 컴포넌트가 `DashboardErrorBoundary`로 래핑되어 있음을 렌더 테스트로 확인 (오류를 던지는 더미 컴포넌트를 등록 → 렌더 결과에 크래시 대신 에러 UI가 나오는지)
- `loadPlugins()`가 `activate()` 예외 발생 시 나머지 플러그인 로딩을 계속하는지

기존 `apps/host-twin/__tests__`에는 `registerPluginPanel` 스토어 액션에 대한 테스트를 추가한다 (그리드 맨 아래 배치 로직, 중복 id 멱등성).

turbo 파이프라인의 `pnpm test`에 새 패키지가 자동 편입된다 (`pnpm-workspace.yaml`이 `packages/*`를 이미 포함).

---

## 6. 릴리즈

CONTRIBUTING.md 규칙대로, 구현 완료 후 `pnpm changeset`으로 `@sdf/plugin-runtime`의 최초 minor 버전과 변경 로그를 기록한다.

---

## 7. 영향받는 기존 파일

| 파일 | 변경 내용 |
|---|---|
| `packages/types/src/index.ts` | `LayoutPanelId`를 `string`으로 widening (그 외 `SDFPlugin`/`PluginContext`/`PluginPanel`/`PluginProps`는 이미 존재, 변경 없음) |
| `apps/host-twin/store/factoryStore.ts` | `registerPluginPanel` 액션 추가 |
| `apps/host-twin/app/page.tsx` | `panelContent` 구성을 `registry.getPanelComponents()`와 머지하도록 변경 |
| `apps/host-twin/lib/plugins.ts` | 신규 — 설치된 플러그인 정적 배열 |
| `apps/host-twin/lib/pluginBootstrap.ts` | 신규 — 레지스트리/컨텍스트 초기화 |
| `packages/plugin-runtime/*` | 신규 패키지 |

`components/LayoutManager.tsx`, `DEFAULT_LAYOUT`, 기존 6개 패널 컴포넌트는 변경하지 않는다.
