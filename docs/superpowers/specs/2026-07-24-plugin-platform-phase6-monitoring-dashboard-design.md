# Phase 6 — 플러그인 모니터링 대시보드 설계

**날짜:** 2026-07-24
**상태:** 브레인스토밍 완료, 구현 계획 대기
**로드맵:** `docs/superpowers/specs/2026-07-22-plugin-platform-roadmap-v2.md` Phase 6 섹션 참조

## 1. 목표 및 스코프

`DashboardErrorBoundary`가 지금은 렌더링 에러를 인라인으로만 보여주고 어디에도 보고하지 않는다. Phase 6은 이를 중앙 채널로 보고하도록 확장하고, 그 이력을 Phase 3b의 `PluginInspectorPanel`에 통합해 보여준다. 로드맵이 이 Phase에서 결정하라고 명시한 "백엔드(Phase 1의 `CollectorRegistry`/`PipelineRegistry`) 에러 로그도 같은 대시보드에 통합할지"는 **통합한다**로 결정.

**포함:**
- `DashboardErrorBoundary`가 잡는 렌더링 에러를 `PluginRegistry`에 보고 (플러그인 패널만, 아래 §2 참조)
- 백엔드 `CollectorRegistry`/`PipelineRegistry`의 `print()`-only 에러 로그를 저장 + 프런트로 실시간 push
- `PluginInspectorPanel`을 3개 섹션(플러그인 / 패널 렌더링 에러 / 백엔드 에러)으로 확장

**제외 (스코프 밖, 브레인스토밍 중 명시적으로 결정):**
- **내장 패널(built-in panel)의 렌더링 에러는 이번 스코프 밖.** `MachineDetailPanel`/`RobotDetailPanel`/`RuleEditorPanel`/`MesReroutingViewer`/`PluginInspectorPanel` 자신을 감싸는 `DashboardErrorBoundary`는 "plugin id"라는 개념 자체가 없어, Phase 3b의 `PluginRegistry` 에러 채널에 자연스럽게 담을 수 없다. `canvas`/`charts`/`agent`는 애초에 `DashboardErrorBoundary`로 감싸여 있지도 않다. 이 Phase는 플러그인 패널(즉 `PluginRegistry.getPanelComponents()`를 거치는 패널)의 렌더링 에러만 다룬다.

## 2. 왜 렌더링 에러를 "플러그인 id"가 아닌 "패널 id"로 기록하는가

애초 "플러그인 id 기준으로 기록"을 시도했으나, 구조적으로 불가능함을 확인했다: `PluginRegistry.registerPanelComponent(panelId, component)`는 panel id만 받을 뿐 어느 플러그인이 등록했는지 모른다 — Phase 3b에서 `panelIds`를 `PluginSummary`에서 뺀 것과 정확히 같은 이유(모든 플러그인이 `pluginBootstrap.ts`에서 만들어진 단일 공유 `PluginContext`를 통해 활성화되므로, 호출 주체를 알아낼 방법이 없음). 이를 실제로 고치려면 플러그인별 `PluginContext`를 만들어 `pluginId`를 클로저로 묶어야 하는데(`createPluginContext`/`loadPlugins` 시그니처 변경), 이번 스코프에는 과도하게 침습적이라 판단해 제외.

대신 렌더링 에러는 **panel id 기준**의 별도 맵에 기록한다. 대부분의 플러그인이 패널 1개만 등록하므로 panel id와 plugin id가 사실상 1:1인 경우가 많아 UI상 큰 차이는 없다. `PluginInspectorPanel`은 이 사실을 숨기지 않고, 등록/활성화 에러(plugin id 기준)와 렌더링 에러(panel id 기준)를 서로 다른 섹션으로 명확히 분리해 보여준다.

## 3. 프런트엔드 — 렌더링 에러 보고 경로

### 3.1 `DashboardErrorBoundary` (`packages/ui/src/DashboardErrorBoundary.tsx`)

`@sdf/ui`는 `@sdf/types`에만 의존하고 `@sdf/plugin-runtime`을 모른다(패키지 경계 유지가 목적). 새 의존성을 추가하는 대신 선택적 콜백 prop을 추가한다:

```ts
interface Props {
  children: ReactNode
  label?: string
  onError?: (error: Error) => void   // 신규, 선택적
}
```

`componentDidCatch`에서 기존 `console.error` 호출 다음에 `this.props.onError?.(error)`를 추가한다. 옵트인이므로 내장 패널들의 기존 `<DashboardErrorBoundary label="...">` 사용처는 전혀 영향받지 않는다.

### 3.2 `PluginRegistry` (`packages/plugin-runtime/src/registry.ts`)

```ts
export interface PanelRenderError {
  message: string
  ts: number
}
```

새 내부 상태: `private renderErrors = new Map<string, PanelRenderError[]>()` (panel id 기준, Phase 3b의 plugin-id 기준 `errors` 맵과 별개).

새 메서드: `recordRenderError(panelId, error)`, `getRenderErrors(panelId): PanelRenderError[]`, `getAllRenderErrors(): Map<string, PanelRenderError[]>` (모두 Phase 3b의 `getErrors`/`getAllErrors`와 동일하게 방어적 복사본 반환 — Phase 3b 코드 리뷰에서 발견된 앨리어싱 버그를 처음부터 반복하지 않는다).

`getPanelComponents(props)`가 각 패널을 `DashboardErrorBoundary`로 감쌀 때 `onError` 콜백을 넘기도록 수정:

```ts
result[id] = createElement(DashboardErrorBoundary, {
  label: id,
  onError: (error) => this.recordRenderError(id, { message: error.message, ts: Date.now() }),
  children: createElement(PanelRenderer, { component, props }),
})
```

## 4. 백엔드 — Collector/PipelineStage 에러 저장 + 실시간 push

### 4.1 에러 저장 (프런트와 동일한 이름의 메서드로 패턴 통일)

`apps/backend-sim/plugins/collector_registry.py`, `pipeline_registry.py` 각각에:

```python
@dataclass
class PluginErrorEntry:
    message: str
    ts: float
```

- `private self._errors: dict[str, list[PluginErrorEntry]] = {}`
- `record_error(self, id: str, message: str) -> None`
- `get_all_errors(self) -> dict[str, list[PluginErrorEntry]]`

기존 `poll_once()`/`run()`의 `print(...)` 호출 바로 다음 줄에 `self.record_error(collector.id, str(e))` / `self.record_error(stage.id, str(e))`만 추가 — 캐시 유지, 스테이지 통과, `print()` 등 기존 동작은 그대로.

**자체 검토 중 발견한 문제:** `PipelineRegistry.run()`은 10Hz `simulation_loop`에서 머신마다 매 tick 호출된다. `FailingStage`처럼 계속 실패하는 스테이지가 있으면 `record_error`가 초당 수십 번 호출되어 `_errors[stage_id]`가 이론상 무한정 커진다. 다만 항목 하나가 작은 문자열(수십 바이트)이라 실제 위험은 낮고, 캡을 두면 §4.3의 `detect_new_plugin_errors`(리스트 길이를 "지난번 본 개수"와 비교하는 diff 방식)가 오래된 항목이 잘려나갈 때 인덱스가 어긋나는 문제가 새로 생긴다 — 캡과 diff 방식을 동시에 정확하게 유지하려면 별도의 단조증가 카운터가 필요해져 오히려 복잡도가 늘어난다. Phase 2의 `CollectorRegistry._cache`/`_owner` 미해제 문제와 같은 성격("작지만 이론상 무제한")으로 판단해, 지금은 캡을 걸지 않고 로드맵 백로그 항목으로만 기록한다(§9).

### 4.2 새 WSMessage 타입 (`packages/types/src/index.ts`)

```ts
export interface PluginErrorEvent {
  source: "collector" | "pipeline_stage"
  id: string
  message: string
  ts: number
}
```
```ts
| { type: "plugin_error"; payload: PluginErrorEvent }
```

### 4.3 새 에러 감지 + push — `simulation_loop`에 직접 넣지 않고 별도 테스트 가능한 함수로 분리

`apps/backend-sim/main.py`의 `simulation_loop`는 이미 매 tick `_last_status`를 diff해서 `anomaly_detected`를 쏘는 것과 동일한 패턴을 쓴다. 같은 방식으로, 새로 생긴 에러 개수를 diff하는 로직을 **순수 함수로 분리**한다(무한루프인 `simulation_loop` 자체는 직접 테스트하지 않는다는 것이 `test_plugin_integration.py`의 `test_anomaly_transition_detection_fires_on_any_source_of_fault`가 이미 세운 이 코드베이스의 컨벤션 — 같은 방식을 따른다):

```python
def detect_new_plugin_errors(
    all_errors: dict[str, list[PluginErrorEntry]],
    source: str,  # "collector" | "pipeline_stage"
    last_seen_counts: dict[str, int],
) -> list[PluginErrorEvent]:
    """레지스트리의 현재 전체 에러 목록과 '지난번에 본 개수'를 비교해 새로 추가된 것만 반환.
    last_seen_counts는 호출자가 들고 있다가 반환값 반영 후 갱신한다."""
    new_events = []
    for id, entries in all_errors.items():
        seen = last_seen_counts.get(id, 0)
        for entry in entries[seen:]:
            new_events.append(PluginErrorEvent(source=source, id=id, message=entry.message, ts=entry.ts))
        last_seen_counts[id] = len(entries)
    return new_events
```

`simulation_loop`는 매 tick 두 레지스트리 각각에 대해 이 함수를 호출하고, 반환된 이벤트들을 `gateway.broadcast({"type": "plugin_error", "payload": ...})`로 push한다. `_last_error_counts`(collector용) / `_last_pipeline_error_counts`(stage용) 두 개의 dict를 `main.py` 모듈 레벨에 `_last_status`처럼 둔다.

이 접근은 collector(자체 비동기 루프에서 채워짐)와 pipeline stage(같은 tick에서 채워짐) 두 경로를 하나의 메커니즘으로 통일한다 — 매 tick 두 레지스트리를 훑어 새 항목만 push하면 두 경로 모두 커버되기 때문이다. 레지스트리 생성자 변경도, 레지스트리→게이트웨이 직접 결합도 필요 없다(Phase 1이 확립한 "레지스트리는 캐시/격리만, 브로드캐스트는 별도 루프"라는 관심사 분리 유지).

## 5. 프런트 소비 — WS → store → UI

`apps/host-twin/hooks/useWebSocket.ts`의 기존 `else if (msg.type === "...")` 체인에 추가:
```ts
} else if (msg.type === "plugin_error") {
  store.addBackendPluginError(msg.payload)
}
```

`factoryStore.ts`에 새 슬라이스(`alertHistory`와 동일한 패턴):
```ts
backendPluginErrors: PluginErrorEvent[]
addBackendPluginError: (event: PluginErrorEvent) => void
```

## 6. UI — `PluginInspectorPanel` 확장

컴포넌트는 여전히 순수 prop 기반(DI) 유지: `{ registry: PluginRegistry; backendErrors: PluginErrorEvent[] }`. `page.tsx`가 `backendErrors={useFactoryStore((s) => s.backendPluginErrors)}`로 넘긴다.

3개 섹션으로 구성:
1. **플러그인** — 기존 그대로(`list()` 기반 active/rejected, plugin id 기준).
2. **패널 렌더링 에러** (신규) — `registry.getAllRenderErrors()`를 순회, panel id + message + 상대시각. 새로고침 버튼 클릭 시 기존 스냅샷과 함께 갱신됨(별도 갱신 트리거 불필요 — 이미 `readSnapshot()`이 registry 전체를 다시 읽으므로 `getAllRenderErrors()` 호출만 추가하면 됨).
3. **백엔드 에러** (신규) — `backendErrors` prop을 그대로 순회, `source`(collector/pipeline_stage) 배지 + id + message + 상대시각. 이건 Zustand 스토어 구독을 통해 실시간 갱신되므로 새로고침 버튼과 무관.

에러가 하나도 없는 섹션은 헤더만 두고 내용은 비워두거나(Phase 3b의 "빈 상태엔 별도 UI 불필요" 원칙 유지), 아예 렌더링하지 않는다 — 구현 계획 단계에서 세부 마크업 결정.

## 7. 테스트 계획

**프런트:**
- `DashboardErrorBoundary`: `onError` prop이 실제로 호출되는지(신규 테스트), 기존 4개 테스트는 변경 없이 통과해야 함.
- `PluginRegistry`: `recordRenderError`/`getRenderErrors`/`getAllRenderErrors` 단위 테스트(빈 배열 기본값, 방어적 복사 포함 — Phase 3b 리뷰에서 잡힌 앨리어싱 버그 패턴을 처음부터 반복하지 않도록 이 테스트를 먼저 작성). `getPanelComponents()`가 만든 패널이 실제로 throw할 때 `recordRenderError`가 호출되는지 통합 테스트(기존 "isolates a panel component that throws" 테스트 옆에 추가).
- `factoryStore`: `addBackendPluginError` 단위 테스트.
- `useWebSocket`: `plugin_error` 메시지 수신 시 `store.addBackendPluginError`가 호출되는지(기존 파일의 다른 메시지 타입 테스트와 동일한 패턴 확인 후 추가).
- `PluginInspectorPanel`: 신규 2개 섹션(패널 렌더링 에러, 백엔드 에러) 각각의 렌더링 테스트 — 기존 5개 테스트는 변경 없이 통과해야 함.

**백엔드:**
- `CollectorRegistry`/`PipelineRegistry`: `record_error`/`get_all_errors` 단위 테스트, 기존 `print()` 유지 확인(회귀 없음).
- `detect_new_plugin_errors()`: 순수 함수 단위 테스트 — 첫 호출 시 전체 반환, 두 번째 호출 시 새로 추가된 것만 반환, 에러 없는 id는 무시, `last_seen_counts`가 실제로 갱신되는지. `test_plugin_integration.py`의 기존 transition-detection 테스트와 같은 파일/스타일.
- `simulation_loop` 자체는 무한루프라 직접 테스트하지 않음(기존 컨벤션 유지) — `detect_new_plugin_errors()`가 유일한 신규 로직이므로 이 함수의 단위 테스트가 사실상 전체 커버리지.

## 8. 의존관계

- Phase 0(`DashboardErrorBoundary`), Phase 1(`CollectorRegistry`/`PipelineRegistry`), Phase 3b(`PluginRegistry`의 plugin-id 기준 에러 채널, `PluginInspectorPanel`) 완료 전제 — 모두 완료됨.
- 로드맵 원안의 "Phase 3에서 설계된 채널을 Phase 6이 재사용" 방향을 따르되, 렌더링 에러는 새 채널(panel id 기준)로 분리 — §2 참조.

## 9. 백로그로 이관하는 항목

- **`CollectorRegistry`/`PipelineRegistry`의 `_errors` 무제한 누적** (§4.1 자체 검토에서 발견): 계속 실패하는 Collector/PipelineStage가 있으면 에러 리스트가 가동 시간에 비례해 무한정 커진다. 항목 자체는 작아 당장 위험하지 않고, 캡을 걸면 diff 기반 push 메커니즘과의 상호작용이 복잡해지므로 이번 스코프에서는 제외. 로드맵 문서의 기존 "Phase 2 `_cache`/`_owner`" 백로그 항목과 같은 성격 — 실제로 문제가 되는 시점(장시간 가동 + 지속적 실패 스테이지)이 오면 그때 캡 + 단조증가 카운터를 함께 설계.
