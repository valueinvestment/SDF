# Phase 3b — Plugin Inspector 설계

**날짜:** 2026-07-24
**상태:** 브레인스토밍 완료, 구현 계획 대기
**로드맵:** `docs/superpowers/specs/2026-07-22-plugin-platform-roadmap-v2.md` Phase 3 섹션(3a/3b 분리) 참조

## 1. 목표 및 스코프

개발 모드 전용 UI 패널로 `PluginRegistry`에 등록된 플러그인 목록과 등록/활성화 과정에서 발생한 에러를 보여준다.

**포함:**
- `PluginRegistry`에 읽기 전용 introspection API(`list()`, `getErrors()`, `getAllErrors()`) 추가
- 등록 시점(`register()` id 충돌, 패널 id 충돌) + 활성화 시점(`activate()` 실패) 에러 기록
- 기존 대시보드 그리드에 통합되는 built-in Inspector 패널 UI

**제외 (스코프 밖):**
- **화이트리스트 준수 검증** — 현재 구조에서 플러그인은 `PluginContext`(TS 타입으로 강제)로만 호스트와 상호작용하므로 위반이 원천적으로 불가능. Phase 4(동적 로딩, 신뢰할 수 없는 코드 실행)에서 실질적 의미가 생기므로 그때 재검토.
- **렌더링(런타임) 에러 리포팅** — `DashboardErrorBoundary`가 잡는 렌더 에러를 중앙 채널로 보고하는 것은 Phase 6의 범위. Phase 3b는 등록/활성화 시점 에러만 다룬다. 단, Phase 3b에서 설계하는 에러 채널(`PluginError`/`PluginRegistry.errors`)은 Phase 6이 그대로 재사용할 수 있도록 설계한다(로드맵 의존관계 명시 사항).
- **rule/metric 등록 개수 표시** — 브레인스토밍 중 논의되었으나 목적에 기여하지 않아 제외. 백로그로 로드맵 문서에 기록됨(`docs/superpowers/specs/2026-07-22-plugin-platform-roadmap-v2.md` "백로그 — Plugin Inspector에 rule/metric 등록 개수 표시").
- **백엔드(`CollectorRegistry`/`PipelineRegistry`) 에러 통합** — 별도 런타임/언어이며, 로드맵상 이 통합 여부 자체를 Phase 6이 결정하도록 명시되어 있음.

## 2. 데이터 모델 (`packages/plugin-runtime/src/registry.ts`)

```ts
export type PluginErrorKind = "register_conflict" | "panel_id_conflict" | "activate_failed"

export interface PluginError {
  kind: PluginErrorKind
  message: string
  ts: number
}

export type PluginSummary =
  | {
      status: "active"
      id: string
      name: string
      version: string
      description?: string
      panelIds: string[]
    }
  | {
      status: "rejected"
      id: string
      message: string
      ts: number
    }
```

`panelIds`는 `PluginRegistry`가 이미 들고 있는 `panelComponents` 맵에서 해당 플러그인이 등록에 성공한 패널 id만 뽑아 채운다(별도 배관 불필요).

## 3. `PluginRegistry` API 확장

새 메서드:
- `list(): PluginSummary[]` — 성공 등록된 플러그인(`status: "active"`) + 등록 자체가 거부된 시도(`status: "rejected"`) 모두 반환.
- `getErrors(id: string): PluginError[]` — 특정 플러그인의 에러 이력. 없으면 빈 배열.
- `getAllErrors(): Map<string, PluginError[]>`

새 내부 상태:
- `private errors = new Map<string, PluginError[]>()` — 성공 등록된 플러그인의 활성화 후 에러 이력.
- `private rejected: { id: string; message: string; ts: number }[] = []` — `register()` 자체가 실패해 `plugins` map에 들어가지 못한 시도들.

새 내부 메서드(패키지 내부 전용, `loadPlugins`가 호출):
- `recordError(pluginId: string, error: PluginError): void`
- `recordRejected(id: string, message: string): void`

## 4. 에러 분류 및 기록 흐름

### 4.1 `register()` 충돌 → `rejected`

`register()`의 유일한 실패 원인은 id 충돌이므로, `loadPlugins()`의 반복문이 자기 자신의 `plugin.id`를 이미 알고 있는 채로 직접 기록한다. 별도 Error 서브클래스나 `instanceof` 분류가 필요 없다.

```ts
for (const plugin of plugins) {
  try {
    registry.register(plugin)
  } catch (err) {
    registry.recordRejected(plugin.id, (err as Error).message)
    continue // 등록 실패 → activate() 호출하지 않음
  }
  // ... activate 단계 (4.2)
}
```

### 4.2 패널 id 충돌 → `panel_id_conflict`

패널 id 충돌은 두 곳에서 발생할 수 있다: (a) `PluginRegistry.registerPanelComponent()` — 플러그인 간 충돌, (b) 호스트 앱의 `registerPluginPanel`(`apps/host-twin/store/factoryStore.ts`) — 내장 패널 id와의 충돌. 두 경로 모두 같은 종류의 실패이므로, **동일한 에러 클래스 하나**를 공유해 일관되게 분류한다.

새 파일 `packages/plugin-runtime/src/errors.ts`:

```ts
export class PluginPanelConflictError extends Error {}
```

- `registry.registerPanelComponent()`가 패널 id 충돌 시 `PluginPanelConflictError`를 throw하도록 변경 (기존엔 plain `Error`).
- `apps/host-twin/store/factoryStore.ts`의 `registerPluginPanel`이 내장 id 충돌 시 `@sdf/plugin-runtime`의 `PluginPanelConflictError`를 throw하도록 변경 (`apps/host-twin`은 이미 `@sdf/plugin-runtime`에 의존하므로 순환참조 없음).

### 4.3 `activate()` 실패 → `panel_id_conflict` 또는 `activate_failed`

`plugin.activate(ctx)` 호출(동기 throw 및 반환된 Promise의 reject 모두)을 감싸는 단일 catch에서 분류한다 — **기록 지점은 정확히 한 곳**이라 이중 기록이 발생하지 않는다.

```ts
try {
  const result = plugin.activate(ctx)
  if (result instanceof Promise) {
    result.catch((err) => recordActivateError(plugin.id, err))
  }
} catch (err) {
  recordActivateError(plugin.id, err)
}

function recordActivateError(pluginId: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err)
  const kind = err instanceof PluginPanelConflictError ? "panel_id_conflict" : "activate_failed"
  registry.recordError(pluginId, { kind, message, ts: Date.now() })
}
```

이 시점엔 `registry.register(plugin)`이 이미 성공했으므로 플러그인은 `status: "active"`로 `list()`에 남고, 에러 이력만 붙는다.

## 5. Inspector UI 패널

- **파일:** `apps/host-twin/components/PluginInspectorPanel.tsx`
- **패널 id:** `"inspector"` — `BUILT_IN_PANEL_IDS`에 추가해 플러그인이 이 id를 선점할 수 없도록 한다.
- **기본 visible:** `process.env.NODE_ENV !== "production"`. 사용자가 `LayoutManager`에서 언제든 수동으로 켜고 끄는 것은 이 기본값과 무관하게 항상 가능.
- **데이터 소스:** `pluginRegistry.list()` / `pluginRegistry.getAllErrors()`를 직접 호출한 정적 스냅샷. 플러그인은 부팅 시 1회만 등록되므로 Zustand 구독이나 폴링은 불필요(과설계 방지).
- **표시 내용:**
  - `active` 플러그인 카드: id / name / version / description / `panelIds`, 에러 이력이 있으면 kind별 배지 + message + 상대 시각.
  - `rejected` 항목 카드: 시도한 id + 실패 사유 + 시각.
  - 에러가 없는 플러그인은 에러 배지 없이 기본 정보만 — 별도 "empty state" UI 불필요.
- **비동기 활성화 실패에 대한 신선도(freshness) 처리:** 비동기 `activate()`의 reject는 Inspector 패널이 마운트된 이후에 도착할 수 있어(정적 스냅샷은 그 시점 이후의 에러를 반영하지 못함), 패널에 수동 "새로고침" 버튼을 두어 클릭 시 `list()`/`getAllErrors()`를 다시 읽어 로컬 state를 갱신한다. 구독/폴링 시스템을 새로 만들 정도의 가치는 없다고 판단(개발 전용 진단 도구이고, 대부분의 `activate()`는 마운트 이전에 이미 정착됨) — 하지만 아예 갱신 수단이 없는 것은 실사용 시 혼란을 줄 수 있어 최소한의 수동 갱신만 추가.

## 6. 테스트 계획

**`packages/plugin-runtime`:**
- `PluginPanelConflictError`가 `registerPanelComponent()`의 패널 id 충돌 시 던져지는지.
- `PluginRegistry.list()`가 `active`/`rejected` 항목을 올바르게 함께 반환하는지.
- `getErrors()`/`getAllErrors()`가 `register_conflict`(→ `rejected`에만 노출, `errors` map에는 없음) / `panel_id_conflict` / `activate_failed` 세 kind를 정확히 분류하는지, 동기 throw와 async reject 양쪽 경로 모두.

**`apps/host-twin`:**
- `registerPluginPanel`이 내장 id 충돌 시 `PluginPanelConflictError`를 던지는지. 기존 테스트가 plain `Error` 메시지 매칭에 의존한다면 구현 단계에서 갱신.
- `PluginInspectorPanel`이 `active`/`rejected` 케이스를 올바르게 렌더링하는지.
- Inspector 패널의 `NODE_ENV` 조건부 기본 visible 값.

**기존 테스트 영향:** `registry.test.tsx`/`loader.test.ts`의 throw 관련 기존 테스트는 에러 타입이 `PluginPanelConflictError`로 바뀌는 지점만 확인/조정하면 되고, 나머지 동작(throw 자체가 일어난다는 것)은 그대로 유지된다.

## 7. 의존관계

- Phase 0(`PluginRegistry`, `DashboardErrorBoundary`) 완료 전제.
- Phase 3a와 독립적 — 이미 완료된 `create-plugin` CLI와 데이터 의존성 없음.
- Phase 6이 이 설계의 에러 채널(`PluginError`, `recordError`)을 재사용할 것을 염두에 두고 설계됨.
