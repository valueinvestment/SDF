# SDF 오픈소스 플러그인 플랫폼 — 확장 로드맵 (v2)

**Date:** 2026-07-22
**Status:** Approved (roadmap), Phase 0 구현 완료, Phase 1 설계 완료 — 구현 대기

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

이후 Phase들이 재사용하는 자산: `PluginRegistry.register()`(Phase 4의 동적 로더가 재사용할 단일 진입점), 화이트리스트 컨텍스트 패턴(Phase 4에서 신뢰 경계로 재확인 필요), 자동 에러 격리 패턴(Phase 6 모니터링 대시보드의 데이터 소스).

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

**목표:** Phase 0의 `PluginPanel` 계약을 실제로 사용하는 예시 플러그인 2개(2D 차트, 위험 알림 로그)를 만들면서, Phase 0에서 존재만 확인하고 손대지 않았던 `PluginProps`를 확정한다.

**핵심 결정 사항:** 10Hz로 갱신되는 센서 데이터를 시각화 플러그인이 매 tick마다 전체 리렌더링하면 안 된다("Render-Bypass" 요구사항). `PluginContext.store`는 Phase 0에서 `getState`/`subscribe` 두 메서드만 노출했는데, Phase 2는 여기에 **선택적 구독 훅**을 얹어야 한다:
```typescript
interface PluginProps {
  useStoreSlice: <T>(selector: (state: ReadonlyFactoryState) => T) => T  // Zustand 선택자 기반, 슬라이스 변경 시에만 리렌더
  // 대용량 파싱은 Web Worker로 오프로드 — Phase 7의 MDF 파서 예시가 이 패턴을 실전 검증
}
```
2D 차트 플러그인은 `useStoreSlice`로 특정 머신의 히스토리만 구독, 위험 알림 로그 플러그인은 `rules`/`alerts` 슬라이스만 구독하는 식으로 검증한다. 두 플러그인 모두 `packages/ui`의 프리미티브 컴포넌트를 우선 사용해야 한다는 CONTRIBUTING.md의 기존 규칙을 그대로 따른다.

**의존관계:** Phase 0의 `PluginPanel`/패널 렌더링 경로 위에서 동작. Phase 1과는 독립적(프런트엔드 전용)이라 병렬 착수 가능.

---

## Phase 3 — 플러그인 보일러플레이트 생성기 + 인스펙터

**목표:** 서드파티 기여자가 `npx create-sdf-plugin`으로 `SDFPlugin` 구현체 + 테스트 + (필요시) Storybook 스토리가 갖춰진 스캐폴드를 즉시 받을 수 있게 한다. 프런트엔드/백엔드 플러그인 두 템플릿을 모두 지원(Phase 0, Phase 1 계약 기준).

**플러그인 인스펙터**는 개발 모드 전용 UI 패널로, `PluginRegistry`에 등록된 플러그인 목록과 각각의 화이트리스트 준수 여부(등록한 패널/룰/지표가 스키마와 일치하는지), id 충돌, 활성화 실패 로그를 시각적으로 보여준다. `PluginRegistry`에 읽기 전용 introspection API(`list()`, `getErrors(id)` 등)를 추가해야 하며, 이는 Phase 6의 모니터링 대시보드와 데이터 소스를 공유하게 될 가능성이 높다 — 두 Phase가 동일한 "에러 리포팅 채널"을 필요로 하므로 착수 순서상 Phase 3에서 설계한 채널을 Phase 6이 재사용하는 편이 낫다.

**의존관계:** Phase 0/1의 계약이 안정된 이후 착수(스캐폴드 템플릿이 계약 변경마다 깨지는 것을 피하기 위함).

---

## Phase 4 — 프런트엔드 런타임 동적 주입 샌드박스

**목표:** 재빌드 없이 `.js` 플러그인 파일을 업로드하면 `import()`로 런타임에 로드되어 즉시 활성화되는 기능. Phase 0의 `PluginRegistry.register()`를 그대로 재사용하고, 위에 `loadPluginFromURL(url, ctx)` 진입점만 추가한다 — 레지스트리의 공개 API는 바뀌지 않는다(Phase 0 설계 문서 §2.2에서 이미 이렇게 설계됨).

**핵심 위험:** 이 Phase부터 실제로 신뢰할 수 없는 코드가 실행된다. Phase 0에서 만든 화이트리스트 `PluginContext`가 유일한 방어선이 되므로, Phase 4 착수 시 반드시 화이트리스트가 여전히 airtight한지 재검증해야 한다(예: 브라우저 전역 객체, `window`, 다른 스크립트로의 접근 경로가 없는지). 필요하면 `<iframe sandbox>` 또는 `Function` 생성자 기반 격리 컨텍스트 도입을 검토한다 — 이 결정은 Phase 4 자체 브레인스토밍에서 내린다.

**의존관계:** Phase 0 필수. Phase 3의 인스펙터가 있으면 업로드된 플러그인의 스키마 검증에 재사용 가능(선택적 의존).

---

## Phase 4.5 — 백엔드 플러그인 동적 로딩

**목표:** Phase 1의 `CollectorRegistry.register()`/`PipelineRegistry.register()`에 `importlib` 기반 동적 모듈 로더를 추가한다. 프런트엔드(Phase 4)와 달리 Python은 브라우저 iframe 같은 손쉬운 프로세스 내 샌드박스가 없으므로, 격리 전략(별도 프로세스/서브프로세스 실행 + IPC, 아니면 신뢰 경계를 "로컬 파일시스템에 배치 가능한 사람"으로 한정하고 프로세스 격리는 하지 않는 절충안)을 Phase 4.5 자체 브레인스토밍에서 명시적으로 결정해야 한다.

**의존관계:** Phase 1 완료 후에만 착수(로드맵 표에 이미 명시된 순서 제약).

---

## Phase 5 — WebSocket 스트림 모킹 데모 모드 + 플러그인 확장

**목표:** 실제 백엔드 없이 저장된/생성된 WS 스트림을 재생해 데모할 수 있는 모드, 그리고 드래그 인터랙션으로 룰을 정의하는 UI(기존 `RuleEditorPanel` 확장). Phase 0의 패널 계약을 재사용해 "데모 컨트롤러" 자체도 하나의 플러그인 패널로 구현 가능한지 검토한다.

**의존관계:** Phase 0 패널 계약. Phase 1이 완료되어 있으면 모킹 스트림도 `Collector` 인터페이스를 구현한 `MockReplayCollector`로 자연스럽게 통합 가능(권장하지만 필수는 아님 — Phase 1과 병행 착수 가능).

---

## Phase 6 — ErrorBoundary 기반 플러그인 모니터링 대시보드

**목표:** Phase 0에서 자동으로 씌워지는 `DashboardErrorBoundary`가 지금은 에러를 인라인으로만 렌더링하고 어디에도 보고하지 않는다. Phase 6은 경계가 에러를 잡을 때 중앙 스토어(또는 Phase 3에서 설계된 인스펙터용 채널)로 보고하도록 확장하고, 그 이력을 보여주는 모니터링 패널을 추가한다. 백엔드 쪽(Phase 1의 `CollectorRegistry`/`PipelineRegistry` 에러 로그)도 같은 대시보드에 통합할지는 이 Phase의 브레인스토밍에서 결정한다.

**의존관계:** Phase 0(에러 바운더리), 이상적으로 Phase 3(인스펙터의 에러 채널 재사용).

---

## Phase 7 — 예시 플러그인 실전 구현 (엔드투엔드 검증)

**목표:** 지금까지의 모든 계약을 실전 수준 예시 하나로 엔드투엔드 검증한다. Web Worker 기반 초대용량 바이너리(MDF/DAT — 산업/자동차 계측 데이터 포맷) 파서를 "데이터 수집 플러그인" 예시로 구현: 프런트엔드에서 파일 업로드 → Web Worker에서 파싱(Phase 2의 Render-Bypass 패턴 실전 적용) → 파싱 결과를 백엔드 `Collector`가 소비하거나, 프런트엔드 전용이라면 `PluginPanel`이 직접 시각화. 정확한 데이터 흐름(풀스택인지 프런트엔드 전용인지)은 Phase 1/2 구현 결과를 보고 이 Phase 착수 시점에 결정한다.

**의존관계:** Phase 1, 2 완료 후 착수(이 둘의 계약을 실제로 스트레스 테스트하는 것이 이 Phase의 존재 이유이므로).

---

## Phase 8 — 문서 갱신 (README / HOW_TO_RUN / CONTRIBUTING)

**목표:** Phase 0~7 전체가 끝난 뒤, 실제 구현된 플러그인 시스템을 반영해 오픈소스 기여자 온보딩 문서를 다시 쓴다. `CONTRIBUTING.md`의 "플러그인 기여 시 유의사항" 절을 프런트엔드/백엔드 플러그인 작성법(각 Phase의 `installed.ts`/`installed.py` 편집법, 테스트 컨벤션)으로 구체화한다. 이 세션에서 이미 발견된 CONTRIBUTING.md의 브랜치 전략 불일치(§별도 확정 완료 — `develop` 브랜치 제거, `main` 직접 기반으로 수정)도 이 시점에 재확인한다.

**의존관계:** Phase 0~7 전체 완료 후.

---

## Phase 9 — 이력서 어필 문서

**목표:** git log와 코드 분석을 근거로, 플러그인 플랫폼 작업뿐 아니라 기존 3계층 렌더링 아키텍처, No-Code Builder Extensions 등 프로젝트 전체의 엔지니어링 결정을 항목별로 "왜 필요했는가 / 안 했으면 어떤 문제가 있었는가 / 개발 후 무엇이 개선됐는가" 구조로 정리한다.

**의존관계:** Phase 0~8 전체 완료 후.

---

## 병행 트랙 — WebGL/Canvas 렌더링 회귀 테스트 자동화

**목표:** 스냅샷 비교 기반 렌더링 회귀 테스트. Phase 0~1과 동시에 진행해, 이후 Phase들(특히 Phase 4의 동적 주입, Phase 7의 대용량 파서)이 3D 캔버스 렌더링을 건드릴 때 회귀를 조기에 잡는 안전망 역할을 한다.

**의존관계:** 없음 — 독립적으로 언제든 착수 가능하며, 빠를수록 이후 Phase의 위험을 낮춘다.

---

## 백로그 — Quadtree 기반 Fleet 시각화 최적화

**목표:** 배치 가능한 엔티티 수 제한이 실제로 늘어나는 요청이 들어올 때 착수. 현재 일정 없음.

---

## 전체 의존관계 요약

```
Phase 0 (완료) ──┬──▶ Phase 2 ──▶ Phase 7 ◀── Phase 1 (설계 완료)
                 ├──▶ Phase 3 ──▶ Phase 6        │
                 ├──▶ Phase 4                    ▼
                 └──▶ Phase 5              Phase 4.5

Phase 0~7 전체 ──▶ Phase 8 ──▶ Phase 9

병행 트랙(회귀 테스트): Phase 0~1과 동시 시작, 이후 전 Phase의 안전망
백로그(Quadtree): 무관, 수요 발생 시 착수
```
