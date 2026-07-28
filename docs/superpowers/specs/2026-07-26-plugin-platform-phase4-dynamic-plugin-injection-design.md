# Phase 4 — 프런트엔드 런타임 동적 주입 샌드박스 설계

**상태:** 브레인스토밍 완료, 사용자 승인 대기
**로드맵 참조:** `docs/superpowers/specs/2026-07-22-plugin-platform-roadmap-v2.md` Phase 4 섹션

## 목표

재빌드 없이 `.js` 플러그인 파일을 런타임에 업로드하면 `import()`로 로드되어 즉시 활성화되는 기능. Phase 0의 `PluginRegistry.register()`를 그대로 재사용하고, 그 위에 `loadPluginFromURL(registry, url, ctx)` 진입점만 추가한다 — 레지스트리의 공개 API는 바뀌지 않는다.

## 위협 모델 (설계를 좌우하는 핵심 결정)

`import()`로 로드된 ES 모듈은 호스트 애플리케이션과 **동일한 JS 런타임/전역 스코프**에서 실행된다. `PluginContext`의 화이트리스트는 `activate(ctx)`에 명시적으로 전달되는 것만 제한할 뿐, 플러그인 코드가 `window`/`document`/`fetch`/`localStorage`/프로토타입 체인 등 주변 전역에 접근하는 것을 막을 수 없다 — 진짜 격리는 `<iframe sandbox>` 같은 별도 realm이 필요하고, 이는 모든 기존 플러그인이 의존하는 `PluginPanel.component: (props) => unknown`이 React 트리에 JSX를 직접 반환하는 계약과 근본적으로 호환되지 않는다(iframe 안의 플러그인은 호스트의 React 트리에 직접 노드를 그릴 수 없다).

**확정된 사용 범위:** 신뢰하는 사용자(기여자/본인)만, 개발 환경에서, 세션 한정으로 사용. 이 전제 하에서 화이트리스트는 "악의적 공격자를 막는 보안 경계"가 아니라 "실수로 내부 상태를 직접 건드리는 것을 막는 실수 방지 장치"로 재정의한다. iframe 격리는 이번 Phase에서 도입하지 않는다.

## 아키텍처 & 데이터 흐름

```
[PluginInspectorPanel]
  업로드 영역 (드래그드롭/파일선택, .js만 허용)
        │ File
        ▼
  file.text() → Blob URL 생성 (type: "text/javascript")
        │ blob: URL
        ▼
  loadPluginFromURL(pluginRegistry, blobUrl, pluginContext)   ← 신규, packages/plugin-runtime/src/loader.ts
        │
        ├─ import(blobUrl)              // 변수 경로라 webpack이 정적분석하지 않고 브라우저 네이티브 동적 import로 컴파일됨
        ├─ 모듈 shape 검증 (default export에 id/name/version/activate 존재?)
        ├─ registry.register(plugin)     // 기존 Phase 0 경로, 변경 없음
        └─ activateAndRecord(registry, plugin, pluginContext)  // loadPlugins()와 공유하는 신규 헬퍼
                │
                └─ 실패 시 registry.recordRejected / recordError → Inspector가 이미 구독 중인 스냅샷에 그대로 노출
        │
        ▼
  URL.revokeObjectURL(blobUrl)   // import() 완료(성공/실패 무관) 직후 해제
```

핵심 포인트:
- **컨텍스트는 공유 인스턴스 재사용.** `pluginBootstrap.ts`가 만든 기존 `pluginContext`를 그대로 넘긴다. 동적 플러그인이라고 별도 컨텍스트를 만들지 않는다 — 플러그인별 attribution(어떤 패널이 어떤 플러그인 소속인지 세밀 추적)은 이번 범위 밖이며, 필요해지면 별도 백로그로 다룬다.
- **에러 노출 경로 완전 재사용.** `loadPlugins()` 내부의 try/catch/record 로직을 `activateAndRecord(registry, plugin, ctx)` 헬퍼로 분리하고, 정적 로딩 루프와 `loadPluginFromURL` 둘 다 이 헬퍼를 호출한다. 업로드한 플러그인이 실패해도 Inspector에 새 UI 없이 기존 "등록 거부됨"/"활성화 실패" 카드로 그대로 노출된다.
- **영속성 없음.** 파일을 읽고 등록하는 일회성 흐름이며, 세션(페이지 새로고침) 종료 시 사라진다.

## 파일 변경 사항

### `packages/plugin-runtime/src/loader.ts` (수정)

```ts
import type { SDFPlugin, PluginContext } from "@sdf/types"
import type { PluginRegistry } from "./registry"
import { PluginPanelConflictError } from "./errors"

export function loadPlugins(
  registry: PluginRegistry,
  plugins: SDFPlugin[],
  ctx: PluginContext,
): void {
  for (const plugin of plugins) {
    if (!registerPlugin(registry, plugin)) continue
    activateAndRecord(registry, plugin, ctx)
  }
}

export async function loadPluginFromURL(
  registry: PluginRegistry,
  url: string,
  ctx: PluginContext,
): Promise<void> {
  const module = await import(/* webpackIgnore: true */ url)
  const plugin = module.default
  assertPluginShape(plugin)
  if (!registerPlugin(registry, plugin)) return
  activateAndRecord(registry, plugin, ctx)
}

function registerPlugin(registry: PluginRegistry, plugin: SDFPlugin): boolean {
  try {
    registry.register(plugin)
    return true
  } catch (err) {
    console.error(`[loadPlugins] failed to register plugin "${plugin.id}"`, err)
    registry.recordRejected(plugin.id, err instanceof Error ? err.message : String(err))
    return false
  }
}

function activateAndRecord(registry: PluginRegistry, plugin: SDFPlugin, ctx: PluginContext): void {
  try {
    const result = plugin.activate(ctx)
    if (result instanceof Promise) {
      result.catch((err) => recordActivateError(registry, plugin.id, err))
    }
  } catch (err) {
    recordActivateError(registry, plugin.id, err)
  }
}

function recordActivateError(registry: PluginRegistry, pluginId: string, err: unknown): void {
  console.error(`[loadPlugins] plugin "${pluginId}" activate() failed`, err)
  const message = err instanceof Error ? err.message : String(err)
  const kind = err instanceof PluginPanelConflictError ? "panel_id_conflict" : "activate_failed"
  registry.recordError(pluginId, { kind, message, ts: Date.now() })
}

function assertPluginShape(plugin: unknown): asserts plugin is SDFPlugin {
  if (
    !plugin ||
    typeof (plugin as SDFPlugin).id !== "string" ||
    typeof (plugin as SDFPlugin).name !== "string" ||
    typeof (plugin as SDFPlugin).version !== "string" ||
    typeof (plugin as SDFPlugin).activate !== "function"
  ) {
    throw new Error("업로드된 파일이 유효한 SDFPlugin을 default export하지 않습니다")
  }
}
```

`assertPluginShape` 실패는 `registry`에 등록되기 전 단계라 Inspector의 "등록 거부됨" 카드로는 뜨지 않고, 호출한 쪽(업로드 UI)에서 잡아 인라인 에러로 표시한다.

### `apps/host-twin/components/PluginInspectorPanel.tsx` (수정)

기존 패널 하단에 업로드 섹션 추가. 새 로컬 상태(`uploadError: string | null`)만 추가하고, 성공 시 기존 `refresh()`로 스냅샷을 갱신한다 — 별도의 "동적 플러그인 목록" state는 두지 않는다(registry가 유일한 소스).

```tsx
const [uploadError, setUploadError] = useState<string | null>(null)

const handleFileUpload = useCallback(async (file: File) => {
  setUploadError(null)
  const text = await file.text()
  const blob = new Blob([text], { type: "text/javascript" })
  const url = URL.createObjectURL(blob)
  try {
    await loadPluginFromURL(registry, url, pluginContext)
    refresh()
  } catch (err) {
    setUploadError(err instanceof Error ? err.message : "플러그인 로드 실패")
  } finally {
    URL.revokeObjectURL(url)
  }
}, [registry, refresh])
```

`pluginContext`는 신규 prop(`PluginInspectorPanel({ registry, backendErrors, pluginContext })`)으로 받는다 — `pluginBootstrap.ts`가 이미 export하는 인스턴스를 `page.tsx`에서 넘긴다.

### `apps/host-twin/app/page.tsx` (수정)

`<PluginInspectorPanel ... pluginContext={pluginContext} />` — import 및 prop 한 줄 추가.

### UI 문구/배치

```
─────────────────────────────
플러그인 업로드 (개발용)
[드래그 드롭 / 클릭 영역: ".js 파일을 드래그하거나 클릭하여 업로드"]
(에러 시) ⚠ {uploadError}
```

`sessionRecorderPlugin.tsx`의 드래그드롭 스타일(테두리 대시, hover 시 emerald 강조)을 재사용한다. `accept=".js"`는 사용자 편의용 힌트일 뿐, 실제 검증은 `assertPluginShape`가 담당한다.

**중복 id 재업로드:** `registry.register()`가 이미 중복 id에 대해 던지므로, 기존 `register_conflict` → `recordRejected` 경로가 그대로 처리한다. 별도 로직 불필요.

## 에러 처리 요약

| 실패 지점 | 처리 | 표시 위치 |
|---|---|---|
| `import()` 실패, `assertPluginShape` 실패 | `loadPluginFromURL`이 throw | 업로드 영역 인라인 (`uploadError`) |
| `registry.register()` 실패 (id 중복) | `recordRejected` | Inspector 기존 "등록 거부됨" 카드 |
| `activate()` 실행 중 예외 | `recordError` | Inspector 기존 "활성화 실패" 배지 |

## 테스트 계획

**`loader.test.ts` (신규 케이스, `loadPluginFromURL` 대상)**

실제 브라우저의 `blob:` URL 동적 import 지원 여부는 테스트 러너(Vitest/Node)마다 다를 수 있으므로, 유닛 테스트는 환경에 관계없이 동작하는 `data:` URL(`data:text/javascript,export default {...}`)을 사용한다. `import()` 메커니즘 자체는 `data:`든 `blob:`든 동일하므로 로더 로직 검증에는 충분하다.

- 정상 케이스: `data:` URL로 유효한 플러그인 로드 → `registry.list()`에 active로 나타남
- `assertPluginShape` 실패: default export에 `activate`가 없는 모듈 → throw, registry는 건드리지 않음
- `activate()` 내부 throw → `getAllErrors()`에 `activate_failed`로 기록
- 중복 id 업로드 → `recordRejected`에 기록

**`PluginInspectorPanel.test.tsx` (신규 케이스)**

`@sdf/plugin-runtime`의 `loadPluginFromURL`을 `vi.mock`으로 교체한다 — 실제 동적 import/Blob 메커니즘은 `loader.test.ts`가 검증하므로, 여기서는 UI 배선만 검증한다.

- 업로드 성공 → `loadPluginFromURL` 호출 확인 + `refresh()`로 활성 목록 갱신
- 업로드 실패(mock reject) → `uploadError` 인라인 표시
- 드래그드롭 → `sessionRecorderPlugin.tsx` 테스트와 동일한 패턴으로 `onDrop` 검증

**구현 단계 실측 필요 사항 (자동 테스트로 커버되지 않음):** 실제 브라우저에서 `import(blobUrl)`이 webpack 없이 정상 동작하는지, 콘솔에 불필요한 "Critical dependency" 경고가 뜨는지 `pnpm dev`로 직접 업로드해 확인한다. 유닛 테스트는 `data:` URL로 우회하기 때문이다.

## 예시 플러그인 (`examples/plugins/`)

Phase 7의 `examples/sdfrec/` 관례를 따라, 업로드 기능을 시연하는 최소 예시 플러그인을 커밋한다.

**`examples/plugins/machine-counter-plugin.js`**

```js
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
```

`props.useStoreSlice`가 `PanelRenderer`(`packages/plugin-runtime/src/registry.ts:23`) 안에서 매 렌더링마다 동일한 위치에서 호출되는 것을 코드로 확인했다 — `sensorChartPlugin.tsx`가 쓰는 것과 같은 훅 패턴이라 Rules of Hooks를 어기지 않는다. `component`가 JSX 없이 plain string만 반환해도 React가 그대로 렌더링하는 것도 기존 테스트(`pluginContextIntegration.test.ts:31`, `component: () => "demo content"`)로 확인된 동작이다.

이 예시 파일은 존재 자체가 목적이라 별도 자동 테스트는 두지 않는다(Phase 7의 `.sdfrec` fixture와 달리, 사용자가 직접 업로드해보는 용도). `PluginInspectorPanel`의 업로드 영역 안내 문구에 "예시: `examples/plugins/machine-counter-plugin.js`를 업로드해보세요" 링크 텍스트를 추가한다.

## 비목표

- iframe 기반 realm 격리 (위협 모델상 불필요, `PluginPanel.component` 계약과 근본적으로 비호환)
- 플러그인별 독립 `PluginContext` 인스턴스 / attribution (필요 시 별도 백로그)
- 백엔드 동적 로딩 (Phase 4.5의 범위)
- 업로드된 플러그인의 영속화 (세션 한정으로 확정)
- 프로덕션 환경 노출 (신뢰된 개발자용 기능)

## 의존관계

Phase 0 필수(완료). Phase 3b에서 만든 기존 Inspector 패널(완료 상태)을 확장하는 형태로 통합하며, 새 패널을 만들지 않는다.
