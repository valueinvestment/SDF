# SDF 오픈소스 플러그인 플랫폼 — 확장 로드맵 (v2)

**Date:** 2026-07-22
**Status:** Approved (roadmap). Phase 0~9 전부 완료(3a/3b, 4.5, 5a/5b 포함) — 9-Phase 로드맵 본편 종료. 남은 것: 병행 트랙(WebGL 회귀 테스트, 미착수), 백로그 7건. (2026-07-30 기준 — 개별 PR 병합 이력은 각 Phase 절 참조, 이 줄은 요약만 유지)

---

## 0. 이 문서의 목적과 범위

`2026-07-22-plugin-platform-phase0-design.md`의 §0 로드맵 표를 대체·확장한다. 기존 표는 각 Phase를 한 줄로만 기록하고 "착수 시점에 별도 브레인스토밍"을 전제했으나, 이 문서는 **Phase 0~9 전체를 한 번에 조망할 수 있도록** 각 Phase의 목표·플러그인 계약 초안·데이터 흐름·다른 Phase와의 의존관계를 3~5문단 수준으로 기록한다.

**이 문서가 제공하지 않는 것:** 각 Phase의 TDD 단위 구현 계획(Task 1, Task 2 ... 형태)은 여기 포함하지 않는다. Phase 0가 그랬듯, 각 Phase는 착수 시점에 이 문서의 해당 절을 출발점 삼아 필요시 세부 브레인스토밍을 한 번 더 거친 뒤 `docs/superpowers/plans/`에 별도 구현 계획 문서를 작성한다. 이는 뒤 Phase일수록 앞 Phase의 실제 구현 결과에 따라 세부 사항이 바뀔 수 있기 때문이다 — 지금 시점에 Phase 7~9까지 TDD 태스크 단위로 확정하는 것은 근거 없는 추측이 된다.

**핵심 설계 원칙 (전 Phase 공통):**
1. **정적 등록 우선, 동적 로딩은 API 설계만 대비.** 모든 Phase의 플러그인은 먼저 "코드에 나열해서 재빌드로 등록"하는 방식으로 동작을 검증하고, 동적 로딩(Phase 4, 4.5)은 같은 `register()` 진입점에 로더만 얹는 형태로 나중에 추가한다.
2. **에러 격리는 프레임워크 책임, 플러그인 작성자 책임이 아니다.** 프런트엔드는 `DashboardErrorBoundary` 자동 래핑(Phase 0), 백엔드는 레지스트리의 per-plugin try/catch(Phase 1)로 한 플러그인의 실패가 호스트 앱이나 다른 플러그인에 전파되지 않도록 한다.
3. **화이트리스트 컨텍스트.** 플러그인은 호스트의 내부 상태나 액션에 직접 접근하지 못하고, 명시적으로 노출된 바인딩(`PluginContext`, 백엔드의 `Collector`/`PipelineStage` 계약)을 통해서만 상호작용한다. 이 원칙은 Phase 4/4.5에서 신뢰할 수 없는 코드가 실제로 실행되기 시작하면 그 가치가 커진다.

---

## Phase 0 — 프런트엔드 플러그인 코어 계약 + 레지스트리 (완료)

**상태:** 구현 완료 (PR: `worktree-plugin-platform-phase0` → `main`). 상세 설계는 `2026-07-22-plugin-platform-phase0-design.md`, 구현 계획은 `2026-07-22-plugin-platform-phase0-implementation.md` 참조.

`@sdf/plugin-runtime` 패키지(`PluginRegistry`, `createPluginContext()`, `loadPlugins()`)를 신설하고, 기존에 정의만 되어 있던 `SDFPlugin`/`PluginContext`/`PluginPanel` 계약을 실제로 동작시켰다. 플러그인은 대시보드 패널 등록, 룰 등록, 계산 지표 등록을 할 수 있다. 패널은 `DashboardErrorBoundary`로 자동 격리되고, `PluginContext`는 `store.getState`/`store.subscribe`/`registerPanel`/`registerRule`/`registerMetric` 4개 키만 노출하는 화이트리스트 구조다. 구현 중 발견되어 수정된 실제 결함 3건(subscribe 바인딩의 store 누출, 내장 패널 id 충돌 시 orphan 등록, read-only 스냅샷의 참조 공유로 인한 라이브 스토어 오염)은 모두 회귀 테스트로 고정되었다.

이후 Phase들이 재사용하는 자산: `PluginRegistry.register()`(Phase 4의 동적 로더가 실제로 재사용한 단일 진입점), 화이트리스트 컨텍스트 패턴(Phase 4에서 "실수 방지 장치"로 재정의됨 — 진짜 보안 경계가 아님을 확인, 상세는 Phase 4 설계 문서 참조), 자동 에러 격리 패턴(Phase 6 모니터링 대시보드의 데이터 소스).

---

## Phase 1 — 백엔드 데이터 수집 + 처리 파이프라인

**상태:** 설계 완료 (이 브레인스토밍 세션). 구현 계획 작성 대기.

### 목표

`apps/backend-sim`은 현재 `SensorSimulator` 하나가 5개 머신의 가짜 센서 데이터를 하드코딩으로 생성해 10Hz로 브로드캐스트한다. Phase 1은 이를 **머신별로 실제 외부 기기/서버에서 데이터를 가져오는 `Collector` 플러그인**과, **수집된 데이터를 머신 단위로 가공하는 `PipelineStage` 플러그인** 두 계약으로 대체한다. `SensorSimulator`는 특별 취급되지 않고 `Collector`의 한 구현체가 된다 — 개발 중에는 시뮬레이션, 실제 설치 현장에서는 머신별로 점진적으로 실기기 Collector(Modbus, OPC-UA, REST 폴링 등)로 교체 가능하다.

### 아키텍처

```
Collector A (Simulator, 동기)          Collector B (REST API, 자체 2초 루프)
  └─ 매 tick 즉시 계산 → cache[M1,M2,M4,M5]   └─ 백그라운드 asyncio task → cache[M3]
                        │
                        ▼
          CollectorRegistry.get_cached_state(machine_id)   ← 절대 블록 안 됨, I/O 대기 없음
                        │
                        ▼
          PipelineRegistry.run(machine_id, state)          ← 순서가 있는 스테이지 체인, 머신별 격리
                        │
                        ▼
   broadcast_loop (10Hz, 기존 유지) → gateway.broadcast(SensorSnapshot)
```

실제 기기/서버는 응답 지연이 크거나(수백 ms) 자체 갱신 주기가 다르므로, Collector의 수집 주기와 10Hz 브로드캐스트 루프를 분리한다. 각 Collector는 자신의 `poll_interval_sec`로 독립적인 백그라운드 asyncio task를 돌며 공유 캐시에 최신값을 쓰고, 브로드캐스트 루프는 캐시에서 읽기만 한다 — 기존 `detail_loop`(2Hz)가 `simulation_loop`(10Hz)와 별도 주기로 도는 것과 동일한 패턴이다.

### 컴포넌트 계약

```python
# apps/backend-sim/plugins/contracts.py
class Collector(Protocol):
    id: str
    machine_ids: list[str]        # 이 Collector가 책임지는 머신들
    poll_interval_sec: float      # 자체 주기 — 10Hz 브로드캐스트 루프와 무관
    async def collect(self) -> dict[str, MachineState]:
        """소유한 모든 머신의 최신 상태를 한 번에 가져온다. 실패 시 raise."""

class PipelineStage(Protocol):
    id: str
    def process(self, machine_id: str, state: MachineState) -> MachineState:
        """매 머신, 매 tick마다 호출. 관심 없는 머신은 그대로 통과시키면 됨."""
```

Collector는 소유 머신 목록과 함께 등록한다(하나의 Modbus 연결이 라인 컨트롤러에서 머신 3대분 데이터를 한 번의 read로 받아오는 실제 상황을 자연스럽게 지원). PipelineStage는 Phase 0의 프런트엔드 플러그인과 동일하게 **플랫한 전역 순서 리스트**로 등록하고, 각 스테이지가 `machine_id`를 보고 자신이 처리할지 스스로 판단한다 — 머신별 별도 등록 메커니즘을 두지 않는다.

### 레지스트리와 에러 격리

- `CollectorRegistry`는 Collector별로 백그라운드 `asyncio.Task`를 띄우고, 결과를 머신 id 기준 공유 캐시에 쓴다. `collect()`가 실패하면 **캐시는 마지막 정상값을 유지**하되, `now - last_success > 3 × poll_interval_sec`가 지나면 조회 시 `status`를 `"offline"`으로 강제한다. `MachineStatus`(현재 `apps/backend-sim/simulator/models.py`와 `packages/types/src/index.ts`에 동일하게 `"normal" | "degraded" | "fault"`로 미러링됨)에 `"offline"`을 추가해야 한다 — Phase 0의 `LayoutPanelId` widening과 같은 성격의 작은 크로스 바운더리 타입 변경.
- `PipelineRegistry.run()`은 각 스테이지를 try/except로 감싼다. 한 스테이지가 특정 머신에서 예외를 던지면 로그를 남기고 그 스테이지 이전 상태를 다음 스테이지로 그대로 전달한다 — 해당 tick이나 다른 머신에 영향 없음(Phase 0의 per-plugin 격리 원칙과 동일).
- 실제 임계값 기반으로 `status="fault"`를 설정하는 것 자체가 하나의 PipelineStage가 된다. 기존의 하드코딩된 랜덤 고장 주입 타이머 대신, **`status`가 `"fault"`로 전이되는 모든 경우**(시뮬레이터의 고장 주입이든, 실제 임계값 기반 스테이지든)에 `anomaly_detected` 이벤트를 발행하도록 일반화한다 — `AgentOrchestrator`는 변경 없음.

### 등록 (정적, Phase 4.5 대비)

Phase 0의 `lib/plugins.ts`와 동일한 패턴:
```python
# apps/backend-sim/plugins/installed.py — 사용자가 편집하는 유일한 진입점
installed_collectors: list[Collector] = [
    SimulatorCollector(machine_ids=["M1","M2","M4","M5"], simulator=simulator),
]
installed_pipeline_stages: list[PipelineStage] = []
```
`CollectorRegistry.register()` / `PipelineRegistry.register()`가 Phase 4.5의 `importlib` 기반 동적 로더가 나중에 호출할 단일 진입점이다 — 그 시점에도 API가 바뀌지 않는다.

### 테스트 계획

`apps/backend-sim`의 기존 21개 pytest 스위트와 동일한 컨벤션: 레지스트리 등록/중복 id 거부, 스테이지 에러 격리(한 스테이지의 예외가 형제 스테이지나 다른 머신에 영향 없음), 오프라인 임계값 이후 상태 전이, 느린 가짜 Collector + 실패하는 가짜 PipelineStage를 엮은 통합 테스트.

### 비목표

동적 로딩(Phase 4.5), 로봇 데이터 수집(로봇은 `AgentOrchestrator`의 디스패치 대상이지 센서 수집 대상이 아님), Collector 설정용 UI(Phase 3의 인스펙터 영역), `AgentOrchestrator`의 디스패치 로직 변경(여전히 `anomaly_detected`를 구독하기만 함).

---

## Phase 2 — 시각화 플러그인 2종 + 공통 Props 규격

**상태:** 구현 완료 (PR: `phase2/plugin-props-example-plugins` → `main`, PR #6). 상세 설계는 `2026-07-23-plugin-platform-phase2-design.md`, 구현 계획은 `2026-07-23-plugin-platform-phase2-implementation.md` 참조.

**목표:** Phase 0의 `PluginPanel` 계약을 실제로 사용하는 예시 플러그인 2개(2D 차트, 위험 알림 로그)를 만들면서, Phase 0에서 존재만 확인하고 손대지 않았던 `PluginProps`를 확정한다.

**핵심 결정 사항:** 10Hz로 갱신되는 센서 데이터를 시각화 플러그인이 매 tick마다 전체 리렌더링하면 안 된다("Render-Bypass" 요구사항). `PluginContext.store`는 Phase 0에서 `getState`/`subscribe` 두 메서드만 노출했는데, Phase 2는 여기에 **선택적 구독 훅**을 얹어야 한다:
```typescript
interface PluginProps {
  useStoreSlice: <T>(selector: (state: ReadonlyFactoryState) => T) => T  // Zustand 선택자 기반, 슬라이스 변경 시에만 리렌더
  // 대용량 파싱은 Web Worker로 오프로드 — Phase 7의 .sdfrec 파서 예시가 이 패턴을 실전 검증 (MDF 대신 자체 포맷으로 축소, 해당 Phase 참조)
}
```
2D 차트 플러그인은 `useStoreSlice`로 특정 머신의 히스토리만 구독, 위험 알림 로그 플러그인은 `rules`/`alerts` 슬라이스만 구독하는 식으로 검증한다. 두 플러그인 모두 `packages/ui`의 프리미티브 컴포넌트를 우선 사용해야 한다는 CONTRIBUTING.md의 기존 규칙을 그대로 따른다.

**구현 방식 결정 (브레인스토밍 완료):**
- Phase 0에 이미 존재하던 죽은 스텁 `PluginProps`(`{ entityId, machines, config, onConfigChange }`)는 폐기하고 `useStoreSlice` 중심으로 새로 정의한다 — 기존 스텁은 `machines`를 통째로 prop으로 내려 10Hz Render-Bypass 요구사항과 충돌했다.
- `useStoreSlice`는 Phase 0가 이미 만든 `PluginContext.store.getState`/`subscribe`(구조: 매 스토어 변경마다 `structuredClone`으로 전체 상태를 복사해 넘기는 방식) 위에 React 공식 `useSyncExternalStore` + 선택자 메모이제이션을 얹어 구현한다. `PluginContextBindings`/`pluginBootstrap.ts`는 건드리지 않는다 — 리렌더링만 슬라이스 단위로 막고, 매 tick마다 발생하는 `structuredClone` 비용 자체는 그대로 남긴다(아래 백로그 항목으로 이관).
- 기존 내장 컴포넌트(`SensorChart.tsx`, `AlertHistory.tsx`)는 이미 `useFactoryStore(selector)`를 직접 써서 동일한 Render-Bypass 효과를 갖고 있으므로 마이그레이션하지 않는다. `useStoreSlice`는 플러그인 전용 화이트리스트 API다.
- 새 예시 플러그인 2개는 `SensorChart`/`AlertHistory`를 이식하지 않고, 같은 주제를 다루는 최소 구현으로 새로 만든다(범위 축소).
- `PluginPanel.component`의 시그니처를 `() => unknown`에서 `(props: PluginProps) => unknown`으로 바꿔야 하므로, `packages/plugin-runtime/src/registry.ts`(`PanelRenderer`)도 함께 수정한다 — 이 때문에 Phase 0(PR #4)을 먼저 main에 머지한 뒤 그 위에서 Phase 2를 시작하기로 함(2026-07-23 완료).

**의존관계:** Phase 0의 `PluginPanel`/패널 렌더링 경로 위에서 동작. Phase 1과는 독립적(프런트엔드 전용)이라 병렬 착수 가능.

---

## Phase 3 — 플러그인 보일러플레이트 생성기 + 인스펙터

**상태:** 두 개의 독립적인 하위 시스템으로 분리해 진행 (브레인스토밍 중 결정). **Phase 3a(생성기 CLI) 완료** — PR: `phase3a/create-plugin-cli` → `main`, PR #7. 상세 설계는 `2026-07-24-plugin-platform-phase3-create-plugin-cli-design.md`, 구현 계획은 `2026-07-24-plugin-platform-phase3a-create-plugin-cli-implementation.md` 참조. 실제 구현은 원래 계획한 `npx create-sdf-plugin`(발행형 npm 패키지) 대신 로컬 레포 스크립트(`pnpm create-plugin <name>`, 프런트엔드 전용, Storybook 미포함)로 축소됨 — 이유는 해당 설계 문서 §1 참조. **Phase 3b(인스펙터) 구현 완료** — 아직 PR은 생성되지 않음(구현 검증까지 마친 다음 단계). 상세 설계는 `2026-07-24-plugin-platform-phase3b-inspector-design.md`, 구현 계획은 `2026-07-24-plugin-platform-phase3b-inspector-implementation.md` 참조.

**목표(원 구상, 3a/3b 분리 이전):** 서드파티 기여자가 `npx create-sdf-plugin`으로 `SDFPlugin` 구현체 + 테스트 + (필요시) Storybook 스토리가 갖춰진 스캐폴드를 즉시 받을 수 있게 한다. 프런트엔드/백엔드 플러그인 두 템플릿을 모두 지원(Phase 0, Phase 1 계약 기준).

**플러그인 인스펙터**는 개발 모드 전용 UI 패널로, `PluginRegistry`에 등록된 플러그인 목록과 각각의 화이트리스트 준수 여부(등록한 패널/룰/지표가 스키마와 일치하는지), id 충돌, 활성화 실패 로그를 시각적으로 보여준다. `PluginRegistry`에 읽기 전용 introspection API(`list()`, `getErrors(id)` 등)를 추가해야 하며, 이는 Phase 6의 모니터링 대시보드와 데이터 소스를 공유하게 될 가능성이 높다 — 두 Phase가 동일한 "에러 리포팅 채널"을 필요로 하므로 착수 순서상 Phase 3에서 설계한 채널을 Phase 6이 재사용하는 편이 낫다.

**의존관계:** Phase 0/1의 계약이 안정된 이후 착수(스캐폴드 템플릿이 계약 변경마다 깨지는 것을 피하기 위함).

---

## Phase 4 — 프런트엔드 런타임 동적 주입 샌드박스 (완료)

**상태:** 구현 완료. 상세 설계는 `2026-07-26-plugin-platform-phase4-dynamic-plugin-injection-design.md`, 구현 계획은 `2026-07-26-plugin-platform-phase4-dynamic-plugin-injection-implementation.md` 참조.

**실제 구현:** 위협 모델을 신뢰된 개발자 전용으로 확정하고(iframe 격리 불필요), `PluginRegistry.register()`를 그대로 재사용하는 `loadPluginFromURL(registry, url, ctx)`를 `loadPlugins()`와 공유하는 `registerPlugin`/`activateAndRecord` 헬퍼 위에 구현했다. 업로드 UI는 새 패널이 아니라 기존 `PluginInspectorPanel`에 통합했으며, `examples/plugins/machine-counter-plugin.js`를 시연용으로 커밋했다.

**목표:** 재빌드 없이 `.js` 플러그인 파일을 업로드하면 `import()`로 런타임에 로드되어 즉시 활성화되는 기능. Phase 0의 `PluginRegistry.register()`를 그대로 재사용하고, 위에 `loadPluginFromURL(url, ctx)` 진입점만 추가한다 — 레지스트리의 공개 API는 바뀌지 않는다(Phase 0 설계 문서 §2.2에서 이미 이렇게 설계됨).

**핵심 위험 (브레인스토밍 결과로 해소됨):** 이 Phase부터 실제로 신뢰할 수 없는 코드가 실행될 수 있다는 우려로 시작했으나, `import()`로 로드된 모듈은 호스트와 동일한 JS 런타임에서 실행되므로 화이트리스트는 애초에 진짜 보안 경계가 될 수 없다는 점을 브레인스토밍에서 확인했다. 진짜 격리(`<iframe sandbox>`)는 모든 기존 플러그인이 의존하는 `PluginPanel.component`의 JSX 직접 반환 계약과 근본적으로 비호환이라 채택하지 않았다. 대신 사용 범위를 신뢰된 개발자·개발 환경·세션 한정으로 확정해 화이트리스트를 "실수 방지 장치"로 재정의했다 — 상세는 `2026-07-26-plugin-platform-phase4-dynamic-plugin-injection-design.md`의 위협 모델 섹션 참조.

**의존관계:** Phase 0 필수. Phase 3의 인스펙터가 있으면 업로드된 플러그인의 스키마 검증에 재사용 가능(선택적 의존).

---

## Phase 4.5 — 백엔드 플러그인 동적 로딩 (완료)

**상태:** 구현 완료. 상세 설계는 `2026-07-28-plugin-platform-phase4-5-backend-dynamic-loading-design.md`, 구현 계획은 `2026-07-28-plugin-platform-phase4-5-backend-dynamic-loading-implementation.md` 참조.

**실제 구현:** Phase 4(프런트엔드)와 마찬가지로 신뢰 기반(프로세스 격리 없음)으로 결정했으나 독립적으로 재평가한 결과다 — PipelineStage가 simulation_loop의 동기 10Hz 핫패스에 있어 서브프로세스 격리 시 매 tick IPC 비용이 크다는 게 결정적 이유였다. `apps/backend-sim/plugins/uploaded/`를 5초마다 폴링하는 `dynamic_loader_loop()`가 `CollectorRegistry.register()`/`PipelineRegistry.register()`를 그대로 재사용하고, 등록 실패는 기존 `record_error()`로 기록되어 Phase 6의 `plugin_error` WS 파이프라인을 통해 프런트엔드 Inspector에 추가 코드 없이 노출된다. 설계 검토 중 "동적 Collector가 도입하는 새 머신은 simulation_loop이 브로드캐스트하지 않아 대시보드에 보이지 않는다"는 기존 아키텍처의 제약을 발견해 비목표로 명시했고, 예시 플러그인은 이 문제가 없는 PipelineStage(`examples/plugins/example_pipeline_stage.py`)로 커밋했다.

**목표 (브레인스토밍으로 해소됨):** Phase 1의 `CollectorRegistry.register()`/`PipelineRegistry.register()`에 `importlib` 기반 동적 모듈 로더를 추가한다. 프런트엔드(Phase 4)와 달리 Python은 브라우저 iframe 같은 손쉬운 프로세스 내 샌드박스가 없어 격리 전략(별도 프로세스/서브프로세스 실행 + IPC, 아니면 신뢰 경계를 "로컬 파일시스템에 배치 가능한 사람"으로 한정하고 프로세스 격리는 하지 않는 절충안)을 결정해야 했으나, 위 "실제 구현" 문단에 정리된 대로 신뢰 기반·프로세스 격리 없음으로 결정했다 — 상세는 `2026-07-28-plugin-platform-phase4-5-backend-dynamic-loading-design.md`의 격리 전략 섹션 참조.

**의존관계:** Phase 1 완료 후에만 착수(로드맵 표에 이미 명시된 순서 제약).

---

## Phase 5 — WebSocket 스트림 모킹 데모 모드 + 플러그인 확장

**상태 (5a, 5b 모두 완료):** 두 독립 서브시스템으로 분리해서 진행했다(Phase 3의 분리 전례와 동일한 이유). "WS 스트림 모킹 데모 모드"(5a)는 구현 완료 — 상세 설계는 `2026-07-28-plugin-platform-phase5a-demo-mode-design.md`, 구현 계획은 `2026-07-28-plugin-platform-phase5a-demo-mode-implementation.md` 참조. "룰 에디터 드래그 인터랙션 확장"(5b)도 구현 완료 — 상세 설계는 `2026-07-29-plugin-platform-phase5b-rule-editor-drag-design.md`, 구현 계획은 `2026-07-29-plugin-platform-phase5b-rule-editor-drag-implementation.md` 참조.

**5b 실제 구현:** 머신↔룰 양방향 드래그 스코핑(머신을 신규 룰 폼에 드래그(A) / 저장된 룰을 머신에 드래그(C), 둘 다 기존 `Rule.machineId` 필드를 사용 — 타입 변경 없음, 네이티브 HTML5 Drag and Drop, 신규 의존성 없음)과, 조건식 입력의 "간단 모드"(변수/연산자 드롭다운, 텍스트 모드와 병행, B)를 구현했다. 액션 순서 재정렬과 다중 머신 스코프는 제외. 설계 중 발견한 `validateFormula`가 커스텀 지표 이름을 항상 거부하던 기존 버그를 같이 고쳤다 — `packages/types`의 `BASE_RULE_VARIABLES` 상수, `packages/core-sdk`의 `listAvailableVariables` 함수로 흩어져 있던 "사용 가능한 변수" 정의를 하나로 모았고, `RuleEditorPanel.tsx`/`FormulaEditor.tsx` 양쪽의 `validateFormula` 호출부를 이 함수 기반으로 고쳤다. 브레인스토밍 중 논의된 단위 변환과 가변 센서 변수(백엔드 확장) 아이디어는 스코프가 크게 달라 백로그로 분리했다(아래 백로그 섹션 참조). subagent-driven-development로 7개 태스크 전부 구현+2단계 리뷰(스펙 준수 → 코드 품질)를 거쳤고, 개별 태스크 리뷰가 잡아낸 실제 버그 3건 + 전체 브랜치를 훑는 최종 홀리스틱 리뷰가 잡아낸 크로스 태스크 버그 1건, 총 4건을 픽스 라운드로 해결했다: (1) `RuleEditorPanel.tsx`가 아직 쓰지 않는 심볼을 앞당겨 추가해 ESLint 에러를 냄(Task 4, 쓰이는 태스크에서 재추가하는 방식으로 정리), (2) 드래그 모의(mock) `dataTransfer.types`가 생성 시점에 고정돼 있어 컴포넌트 자신의 `onDragStart` payload 작성 로직이 테스트로 검증되지 않던 커버리지 공백(Task 4), (3) 이미 활성화된 "간단" 탭을 다시 클릭하면 입력 중이던 선택이 조용히 초기화되던 실제 데이터 손실 버그(Task 6, 모드 전환 여부를 실제로 체크하도록 수정), (4) 드래그로 대상 머신을 재지정해도 이미 입력된 조건식/에러 상태가 재검증되지 않아 새 스코프에 없는 변수를 참조하는 룰이 에러 표시 없이 저장될 수 있던 버그(Task 4/6 경계, 개별 태스크 리뷰로는 못 잡고 최종 브랜치 리뷰에서 발견 — `draftMachineId` state가 아직 리렌더 전이라 클로저가 새 값을 못 보는 게 원인이라 단순 재호출로는 안 고쳐지고 `machineId`를 명시 인자로 받는 헬퍼로 수정). 최종 검증: `pnpm typecheck`/`test`(host-twin 123 + plugin-runtime 46)/`build` 전부 클린, 백엔드 pytest 74/74(파일 무변경, 재확인), 총 12개 커밋(6개 feat/fix + 4개 리뷰발 픽스 + 2개 문서).

**후속 논의(백로그는 아님, 이번 Task 6 코드 품질 리뷰에서 나온 관찰):** `RuleEditorPanel.tsx`가 이번 Phase로 약 400줄까지 커졌다(이 디렉토리에서 가장 큰 파일) — 머신 드래그, 룰 드래그, 조건 빌더, 액션 설정 폼이 한 컴포넌트에 공존한다. 리뷰어는 `AddEntityModal.tsx`/`useAddEntityModal.ts` 전례를 따라 훅+서브컴포넌트로 분리하는 걸 권장했지만, 이번 Phase 스코프 밖이라 실행하지 않았다 — 다음에 이 파일을 다시 건드릴 일이 생기면 먼저 분리를 검토할 것.

**5a 실제 구현:** 설계 단계에서 `apps/host-twin/hooks/useSimulator.ts`가 이미 WS 미연결 시 자동으로 가동되는 모킹 시뮬레이터(사인파+가우시안 노이즈, 고장 주기 포함)를 구현하고 있음을 발견해, 새 생성기를 만드는 대신 `useWebSocket`에 `demoMode` 파라미터를 추가해 실제 연결을 건너뛰게 하는 방식으로 기존 로직을 재사용했다. `PluginProps`에 최초의 쓰기 메서드(`setDemoMode`)를 추가해 새 `demoControllerPlugin` 패널이 런타임에 토글할 수 있게 했다.

**목표(원 구상, 5a/5b 분리 이전):** 실제 백엔드 없이 저장된/생성된 WS 스트림을 재생해 데모할 수 있는 모드, 그리고 드래그 인터랙션으로 룰을 정의하는 UI(기존 `RuleEditorPanel` 확장). Phase 0의 패널 계약을 재사용해 "데모 컨트롤러" 자체도 하나의 플러그인 패널로 구현 가능한지 검토한다.

**의존관계:** Phase 0 패널 계약. Phase 1이 완료되어 있으면 모킹 스트림도 `Collector` 인터페이스를 구현한 `MockReplayCollector`로 자연스럽게 통합 가능(권장하지만 필수는 아님 — Phase 1과 병행 착수 가능).

---

## Phase 6 — ErrorBoundary 기반 플러그인 모니터링 대시보드 (완료)

**상태:** 구현 완료 — 아직 PR은 생성되지 않음(구현 검증까지 마친 다음 단계). 상세 설계는 `2026-07-24-plugin-platform-phase6-monitoring-dashboard-design.md`, 구현 계획은 `2026-07-25-plugin-platform-phase6-monitoring-dashboard-implementation.md` 참조.

**목표:** Phase 0에서 자동으로 씌워지는 `DashboardErrorBoundary`가 지금은 에러를 인라인으로만 렌더링하고 어디에도 보고하지 않는다. Phase 6은 경계가 에러를 잡을 때 중앙 스토어(또는 Phase 3에서 설계된 인스펙터용 채널)로 보고하도록 확장하고, 그 이력을 보여주는 모니터링 패널을 추가한다. 백엔드 쪽(Phase 1의 `CollectorRegistry`/`PipelineRegistry` 에러 로그)도 같은 대시보드에 통합할지는 이 Phase의 브레인스토밍에서 결정한다.

실제 구현: 백엔드는 `CollectorRegistry`/`PipelineRegistry`가 이미 쌓아 두던 에러 이력에서 신규 항목만 골라내는 순수 함수 `detect_new_plugin_errors()`를 추가해 `simulation_loop`(10Hz)에서 매 tick 호출, 새로 발생한 에러만 `plugin_error` WS 메시지로 push한다. 프런트엔드는 `DashboardErrorBoundary`에 `onError` prop을 추가해 렌더링 에러를 잡고, `PluginRegistry`가 패널별 렌더 에러 이력을 추적하도록 확장했다. `factoryStore`에 백엔드 에러 슬라이스를 추가해 `plugin_error` WS 메시지를 라우팅하고, `PluginInspectorPanel`이 프런트엔드 렌더 에러와 백엔드 플러그인 에러를 함께 보여주도록 확장했다.

**의존관계:** Phase 0(에러 바운더리), 이상적으로 Phase 3(인스펙터의 에러 채널 재사용).

---

## Phase 7 — 예시 플러그인 실전 구현 (엔드투엔드 검증) (완료)

**상태:** 구현 완료 — 아직 PR은 생성되지 않음(구현 검증까지 마친 다음 단계). 상세 설계는 `2026-07-26-plugin-platform-phase7-example-plugin-design.md`, 바이너리 포맷 자체의 독립 스펙은 `sdfrec-format-spec.md`, 구현 계획은 `2026-07-26-plugin-platform-phase7-example-plugin-implementation.md` 참조.

**목표:** 지금까지의 모든 계약을 실전 수준 예시 하나로 엔드투엔드 검증한다. Web Worker 기반 초대용량 바이너리(MDF/DAT — 산업/자동차 계측 데이터 포맷) 파서를 "데이터 수집 플러그인" 예시로 구현: 프런트엔드에서 파일 업로드 → Web Worker에서 파싱(Phase 2의 Render-Bypass 패턴 실전 적용) → 파싱 결과를 백엔드 `Collector`가 소비하거나, 프런트엔드 전용이라면 `PluginPanel`이 직접 시각화. 정확한 데이터 흐름(풀스택인지 프런트엔드 전용인지)은 Phase 1/2 구현 결과를 보고 이 Phase 착수 시점에 결정한다.

**실제 구현:** 브레인스토밍 중 실제 MDF4(ASAM 표준, 링크드 블록 그래프 + deflate 압축)는 이 Phase의 목적(플러그인 계약 검증)에 비해 과도하게 복잡하다고 판단해 제외하고, 이 앱 도메인에 맞는 간소화된 자체 바이너리 포맷(`.sdfrec`)을 새로 설계했다(`docs/sdfrec-format-spec.md`). 데이터 흐름도 프런트엔드 전용으로 확정 — 백엔드 `Collector` 연동은 하지 않는다. 자세한 사유는 설계 문서 §1 참조.

**의존관계:** Phase 1, 2 완료 후 착수(이 둘의 계약을 실제로 스트레스 테스트하는 것이 이 Phase의 존재 이유이므로).

---

## Phase 8 — 문서 갱신 (README / HOW_TO_RUN / CONTRIBUTING) (완료)

**상태:** 구현 완료, 커밋 `646ffa7`.

**목표:** Phase 0~7 전체가 끝난 뒤, 실제 구현된 플러그인 시스템을 반영해 오픈소스 기여자 온보딩 문서를 다시 쓴다. `CONTRIBUTING.md`의 "플러그인 기여 시 유의사항" 절을 프런트엔드/백엔드 플러그인 작성법(각 Phase의 `installed.ts`/`installed.py` 편집법, 테스트 컨벤션)으로 구체화한다. 이 세션에서 이미 발견된 CONTRIBUTING.md의 브랜치 전략 불일치(§별도 확정 완료 — `develop` 브랜치 제거, `main` 직접 기반으로 수정)도 이 시점에 재확인한다.

**실제 구현:** 브레인스토밍에서 "전면 재작성 vs 부분 확장" 중 부분 확장을 택했다 — README/HOW_TO_RUN/CONTRIBUTING은 이미 정확하고 잘 정리돼 있어서, 누락된 플러그인 시스템 절만 추가하는 쪽이 리스크가 적다고 판단(이력서 어필용 서사는 별도 목적의 Phase 9 문서로 이미 분리돼 있어 README를 그 용도로 겸용할 필요가 없었음). README에 "확장 가능한 플러그인 플랫폼" 기능 불릿 + 플러그인 개발 절 확장, HOW_TO_RUN에 "Plugins" 절 신설(스캐폴드/동적 로딩 테스트/데모 모드), CONTRIBUTING의 2줄짜리 플러그인 절을 프런트엔드/백엔드 기여 절차·화이트리스트 API 목록·보안 경계 아님 명시·테스트 컨벤션으로 확장. `apps/backend-sim/plugins/installed.py`의 미래시제로 남아있던 stale 주석(Phase 4.5를 "will add"로 서술)도 같이 고쳤다 — Phase 5b에서 고쳤던 `plugins.ts`의 동일 패턴 재발.

**검증:** 별도 서브에이전트로 사실 확인 리뷰를 돌려 문서에 적힌 모든 명령어·경로·API 목록을 실제 소스와 대조 — 전부 일치(오탈자 없음). 리뷰가 지적한 비차단 스타일 이슈 2건(README 플러그인 절이 주변 대비 장황함, HOW_TO_RUN이 목적이 다른 두 예시 파일을 동일 선상에 나열)은 반영해 다듬었다.

**의존관계:** Phase 0~7 전체 완료 후. (2026-07-29, Phase 5b 완료로 이 조건이 충족되어 착수)

---

## Phase 9 — 이력서 어필 문서 (완료)

**상태:** 구현 완료, 커밋 `59f762e`.

**목표:** git log와 코드 분석을 근거로, 플러그인 플랫폼 작업뿐 아니라 기존 3계층 렌더링 아키텍처, No-Code Builder Extensions 등 프로젝트 전체의 엔지니어링 결정을 항목별로 "왜 필요했는가 / 안 했으면 어떤 문제가 있었는가 / 개발 후 무엇이 개선됐는가" 구조로 정리한다.

**실제 구현:** 브레인스토밍에서 언어(한국어+영어 둘 다), 저장 위치(`docs/RESUME_HIGHLIGHTS.md` 계열, 이 저장소의 기존 `ARCHITECTURE.ko.md` 등 영어-기본+`.ko.md` 접미사 컨벤션을 따름), 범위(모든 결정을 망라하는 종합판 + 이력서 XYZ 공식에 바로 옮기기 좋은 베스트 10 선별판, 둘 다 이중언어)를 확정했다. 종합판은 `docs/ARCHITECTURE.md` §8/§9에 이미 있던 "왜 이렇게 했는가" 서술을 소스로 삼고 이 세션에서 직접 겪은 플러그인 플랫폼 9개 Phase(및 Phase 5b의 최종 홀리스틱 리뷰가 잡아낸 태스크 간 버그처럼 세부까지)를 더해 총 19개 항목으로 구성했다. 베스트 10판은 각 항목에 X(성과)/Y(측정 기준)/Z(방법) 분해 + "왜 면접에서 강력한가" 코멘트를 달았다.

**정직성 관련 설계 결정:** 개인 포트폴리오 프로젝트라 매출·사용자 수 같은 비즈니스 지표가 없으므로, 베스트 10판 서두에 "조작된 숫자 없음, 전부 저장소에서 검증 가능한 값이거나 코드에서 직접 도출되는 기술적 사실"이라는 정책을 명시하고 실제로 그렇게 작성했다 — 이 정책이 오히려 리뷰 과정에서 위반 사례(아래) 3건을 스스로 잡아내는 기준이 됐다.

**3단계 독립 리뷰로 실제 오류 다수 발견·수정:** (1) 사실 확인 리뷰 — 코드에 구현되어 있지 않은 "센서 차트 250ms/4Hz 스로틀" 주장(참고로 이 주장은 원래 `docs/ARCHITECTURE.md` 자체에 있던 걸 그대로 인용한 것이었는데, `ARCHITECTURE.md` 쪽도 실제로는 틀린 것으로 확인됨 — 이력서 문서에서는 제거했지만 `ARCHITECTURE.md` 자체는 이번 스코프 밖이라 그대로 남아있음, 후속 정리 필요), ID 접두사 라우팅이 "완전히" 대체됐다는 과장(실제로는 레거시 폴백이 `ws_gateway.py`에 남아있음), 근거 없는 "13만+ 요소" 스택오버플로 수치, 베스트 10판의 조작된 "~90%" 수치를 잡아 수정. (2) 한/영 대조+이력서 품질 리뷰 — 두 언어 버전의 "포함 안 된 항목 수" 오기(~20→9), 오역 1건, 헤지 안 된 최상급 표현, XYZ 공식이 흐려진 항목 2개(#2, #8)를 잡아 수정. (3) 최종 검증 리뷰 — 1·2차 수정이 두 언어 모두에 정확히 반영됐는지, 새 오류가 안 생겼는지 재확인 — 전부 통과.

**후속 정리 항목(백로그는 아니고 단순 메모):** `docs/ARCHITECTURE.md` 성능 표(§7)와 §3.1 본문의 "센서 차트 250ms/4Hz 스로틀" 서술은 실제 코드와 일치하지 않는 것으로 확인됨 — 이번 Phase 9 스코프에서는 이력서 문서만 고치고 `ARCHITECTURE.md` 자체는 건드리지 않았음. 다음에 이 문서를 손댈 일이 있으면 같이 고칠 것.

**의존관계:** Phase 0~8 전체 완료 후. (2026-07-30, Phase 8 완료로 이 조건이 충족되어 착수)

---

## 병행 트랙 — WebGL/Canvas 렌더링 회귀 테스트 자동화

**목표:** 스냅샷 비교 기반 렌더링 회귀 테스트. Phase 0~1과 동시에 진행해, 이후 Phase들(특히 Phase 4의 동적 주입, Phase 7의 대용량 파서)이 3D 캔버스 렌더링을 건드릴 때 회귀를 조기에 잡는 안전망 역할을 한다.

**의존관계:** 없음 — 독립적으로 언제든 착수 가능하며, 빠를수록 이후 Phase의 위험을 낮춘다.

---

## 백로그 — Quadtree 기반 Fleet 시각화 최적화

**목표:** 배치 가능한 엔티티 수 제한이 실제로 늘어나는 요청이 들어올 때 착수. 현재 일정 없음.

---

## 백로그 — PluginContext.store.subscribe의 structuredClone 비용 최적화

**목표:** Phase 0에서 발견되고 Phase 2에서 재확인된 성능 병목. `PluginContextBindings.subscribe`(`apps/host-twin/lib/pluginBootstrap.ts`)는 Zustand 선택자 없이 스토어 전체 변경을 구독하며, 매 tick마다 `structuredClone`으로 전체 상태를 복사해 리스너에 넘긴다. Phase 2의 `useStoreSlice`는 이 위에 선택자 메모이제이션을 얹어 **리렌더링**은 슬라이스 단위로 막았지만, **클론 자체**는 여전히 매번 전체 스토어에 대해 발생한다. 등록된 플러그인이 늘어나거나 스토어가 커지면 무시할 수 없는 CPU 비용이 될 수 있다.

**착수 조건:** 실측(프로파일링)으로 실제 병목임이 확인되거나, 플러그인 수/스토어 크기가 늘어나는 시점. 현재는 추정일 뿐 확정된 문제가 아니므로 조기 최적화하지 않는다.

**가능한 해결 방향(착수 시점에 재검토):** `PluginContextBindings`에 선택자 기반 구독(`subscribeSlice<T>(selector, listener)`)을 추가해 호스트 쪽에서 Zustand의 진짜 선택자 구독을 활용 — 선택된 슬라이스가 실제로 바뀔 때만 클론이 발생하도록 변경.

**의존관계:** 없음 — Phase 2 완료 후 언제든 독립적으로 착수 가능.

---

## 백로그 — Plugin Inspector에 rule/metric 등록 개수 표시

**목표:** Phase 3b(플러그인 인스펙터) 브레인스토밍 중 논의되었으나 이번 스코프에서 제외됨. `PluginRegistry.list()`가 반환하는 `PluginSummary`에 각 플러그인이 등록한 `ruleCount`/`metricCount`를 추가하는 것 — 다만 이 값들을 실제로 검증(화이트리스트 준수 여부 등)하지는 않고 단순 집계로만 노출.

**제외 이유:** Phase 3b는 id 충돌/등록·활성화 실패만 보여주기로 범위를 좁혔고, rule/metric 개수는 그 목적에 기여하지 않음. 또한 구현하려면 `createPluginContext`가 현재 모르는 `pluginId`를 클로저로 전달받도록 시그니처를 넓혀야 해서, 명확한 필요 없이는 배관만 늘리는 셈.

**착수 조건:** 실제로 이 정보가 필요한 구체적 요구(예: 특정 플러그인이 과도하게 많은 rule을 등록해 디버깅이 필요했던 사례)가 생기면 착수.

**의존관계:** Phase 3b 완료 후 언제든 독립적으로 착수 가능.

---

## 백로그 — CollectorRegistry/PipelineRegistry 에러 이력 무제한 누적

**목표:** Phase 6(모니터링 대시보드) 설계 중 자체 검토에서 발견됨. 계속 실패하는 Collector/PipelineStage가 있으면 `_errors` 딕셔너리가 가동 시간에 비례해 무한정 커진다(`PipelineRegistry.run()`은 10Hz `simulation_loop`에서 머신마다 매 tick 호출되므로 실질적 위험이 Phase 2의 `_cache`/`_owner` 사례보다 큼). 항목 캡을 걸면 Phase 6의 diff 기반 실시간 push 메커니즘(리스트 길이를 "지난번 본 개수"와 비교)과 상호작용이 복잡해져(오래된 항목이 잘려나갈 때 인덱스가 어긋남), 이번 스코프에서는 캡 없이 진행.

**착수 조건:** 장시간 가동 + 지속적으로 실패하는 스테이지/Collector가 실제 운영 이슈로 확인되면 착수. 캡을 걸 때는 diff 메커니즘을 위한 별도 단조증가 카운터를 함께 설계해야 함(캡된 저장 리스트와 별개로).

**의존관계:** Phase 6 완료 후 언제든 독립적으로 착수 가능.

---

## 백로그 — 장시간 세션 녹화 기능

**목표:** Phase 7(예시 플러그인) 브레인스토밍 중 논의되었으나 이번 스코프에서 제외됨. 화면용 `HISTORY_MAX`(300개) 캡과 별개로, 사용자가 "녹화 시작"을 누르면 그 이후 샘플을 캡 없이 별도 버퍼에 누적하다가 "녹화 종료" 시 `.sdfrec`로 다운로드하는 기능.

**제외 이유:** 이 앱은 실시간 모니터링에 초점이 맞춰져 있고, 장시간 원본 데이터 녹화는 사후 분석(오프라인 데이터 분석) 목적의 별개 기능이다. 구현하려면 새 스토어 상태(녹화 중 여부, 누적 버퍼)와 시작/종료 UI 컨트롤이 필요해 스코프가 커진다.

**착수 조건:** 실제로 장시간 세션 분석이 필요한 구체적 요구가 생기면 착수.

**의존관계:** Phase 7 완료 후 언제든 독립적으로 착수 가능.

---

## 백로그 — 센서 값 단위 변환 + 단위 인식 커스텀 지표

**목표:** Phase 5b(룰 에디터 드래그 인터랙션) 브레인스토밍 중 논의됨. 현재 `vibration`/`temperature`/`current` 등 모든 센서 값은 단위 개념 없이 raw number로만 존재한다(`packages/types/src/index.ts`에 단위 필드 전무). 값의 단위를 바꿔 볼 수 있는 표시 기능과, 단위를 인식하는 커스텀 연산(예: `ComputedMetric`이 섭씨/화씨를 구분해 계산)이 실제 효용이 있어 보인다는 논의였다. 참고로 "커스텀 연산으로 새 변수 만들기" 자체는 `FormulaEditor.tsx`/`ComputedMetric`으로 이미 존재하지만 단위 인식은 없다.

**제외 이유:** `SensorChart`/`RuleEditorPanel`/`FormulaEditor`/3D 오버레이 등 값이 표시되는 모든 지점에 단위 표시·변환 로직을 추가해야 하는 횡단 관심사로, Phase 5b의 드래그 인터랙션과 성격이 완전히 다르다. 이 프로젝트가 지금까지 지켜온 "번들된 서로 다른 서브시스템은 분리한다" 원칙(Phase 3a/3b, 5a/5b)에 따라 별도 브레인스토밍이 필요.

**착수 조건:** 구체적 필요(예: 다른 단위계를 쓰는 실제 설비 연동)가 생기면 착수. 착수 시 데이터 모델(어느 필드가 어느 기준 단위인지)부터 정의해야 함.

**의존관계:** Phase 5b 완료 후 언제든 독립적으로 착수 가능.

---

## 백로그 — MachineState 가변 센서 변수 지원 (열린 스키마)

**목표:** Phase 5b(룰 에디터 드래그 인터랙션) 브레인스토밍 중 논의됨. 룰 조건/커스텀 지표의 변수 드롭다운이 백엔드가 새로 추가하는 센서 변수(예: `pressure`)를 자동으로 인식하길 원한다는 요구였다. 확인 결과 `apps/backend-sim/simulator/models.py`의 `MachineState`는 `vibration/temperature/current/status` 4개 필드만 갖는 닫힌 Pydantic `BaseModel`(여분 필드는 `extra` 설정이 없어 조용히 버려짐)이고, 프런트엔드 `packages/types/src/index.ts`의 미러 타입도 동일하게 고정이며, `useRuleEngine.ts`의 `vars` 구성도 세 필드를 명시적으로 하드코딩한다. Phase 1(Collector)/Phase 4.5(백엔드 동적 로딩)로 새 Collector/PipelineStage를 얹어도 새 변수 "이름"을 도입할 방법이 지금 아키텍처엔 없다.

**제외 이유:** `MachineState`를 열린 스키마(예: `extra: Record<string, number>` 필드)로 바꾸고 Collector/PipelineStage 계약, WS 직렬화, `factoryStore`, `useRuleEngine`의 `vars` 구성까지 전부 건드려야 하는 백엔드 타입 계약 변경 — Phase 5b의 "드래그 인터랙션"이라는 주제와 무관하고, "센서 값 단위 변환" 백로그 항목과 마찬가지로 별도 브레인스토밍이 필요한 규모. Phase 5b의 변수 드롭다운은 이번 스코프에서 고정 3개 + `ComputedMetric`만 지원하고, UI에 "현재 지원 변수는 고정" 힌트를 명시한다.

**착수 조건:** 실제로 새 센서 타입을 다루는 Collector가 필요해지면(예: 압력 센서 연동) 착수. 착수 시 열린 스키마 설계와 함께 룰/지표 UI의 변수 드롭다운을 정적 목록에서 실제 머신 상태 기반 동적 목록으로 바꿔야 함.

**의존관계:** Phase 1, Phase 4.5, Phase 5b 완료 후 언제든 독립적으로 착수 가능.

---

## 전체 의존관계 요약

```
Phase 0 (완료, 머지됨) ──┬──▶ Phase 2 (완료, 머지됨) ──▶ Phase 7 (완료, PR 미생성) ◀── Phase 1 (완료, PR 리뷰 대기)
                        ├──▶ Phase 3a (완료, PR 리뷰 대기) ──▶ Phase 3b (완료, PR 미생성) ──▶ Phase 6 (완료, PR 미생성)
                        ├──▶ Phase 4 (완료, PR 미생성)                        │
                        └──▶ Phase 5                                       ▼
                                                          Phase 4.5 (완료, PR 미생성)

Phase 0~7 전체 (완료) ──▶ Phase 8 (완료) ──▶ Phase 9 (완료) — 9-Phase 로드맵 본편 종료

병행 트랙(회귀 테스트): Phase 0~1과 동시 시작, 이후 전 Phase의 안전망
백로그(Quadtree): 무관, 수요 발생 시 착수
백로그(subscribe clone 비용): Phase 2 완료 후 언제든, 실측 후 착수
백로그(Inspector rule/metric 개수): Phase 3b 완료 후 언제든, 구체적 필요 발생 시 착수
백로그(장시간 세션 녹화): Phase 7 완료 후 언제든, 구체적 필요 발생 시 착수
백로그(단위 변환): Phase 5b 완료 후 언제든, 구체적 필요 발생 시 착수
백로그(가변 센서 변수): Phase 1, 4.5, 5b 완료 후 언제든, 구체적 필요 발생 시 착수
```
