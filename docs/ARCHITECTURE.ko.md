# 시스템 아키텍처
# SDF 디지털 트윈 멀티 에이전트 시뮬레이터

**작성일:** 2026-05-27  
**버전:** 1.0

---

## 1. 개요

독립적으로 배포된 두 서비스가 단일 영구 WebSocket 연결을 통해 통신합니다. 백엔드는 모든 공장 상태의 단일 진실 공급원이며, 프론트엔드는 순수한 소비자이자 렌더러입니다.

```
┌─────────────────────────────────────────────────────────┐
│                     FRONTEND (Vercel)                   │
│  Next.js 14 + TypeScript                                │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Three.js    │  │   ECharts    │  │  Agent Panel │  │
│  │  (WebGL)     │  │  (Canvas)    │  │  (React DOM) │  │
│  │  60fps 루프  │  │  4Hz 업데이트│  │  이벤트 기반 │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         │                 │                  │          │
│         └─────────────────┴──────────────────┘          │
│                           │                             │
│                    Zustand Store                        │
│                    + robotPosRef (우회)                  │
│                           │                             │
│                    useWebSocket hook                    │
│                    (RAF 드레인 큐)                       │
└───────────────────────────┬─────────────────────────────┘
                            │ WebSocket (wss://)
                            │ ~10Hz 센서 스트림
                            │ 드문 에이전트 이벤트
┌───────────────────────────┴─────────────────────────────┐
│                     BACKEND (Railway)                   │
│  FastAPI + Python + asyncio                             │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │  SensorSimulator (asyncio 태스크, 10Hz)           │   │
│  │  - 기계 5대: 진동, 온도, 전류                      │   │
│  │  - 로봇 3대: x, y, 방향, 상태                     │   │
│  │  - 60~120초마다 고장 주입                          │   │
│  └─────────────────────┬────────────────────────────┘   │
│                        │                                │
│                   EventBus (asyncio.Queue)              │
│                  /              \                       │
│  ┌──────────────┘                └────────────────┐     │
│  │  WebSocketGateway              AgentOrchestrator│     │
│  │  모든 클라이언트에 브로드캐스트  (이상 감지 시)   │     │
│  └──────────────────────         └────────┬────────┘     │
│                                           │             │
│                                  Agent A → B → C        │
│                                  (Claude API 호출)      │
└─────────────────────────────────────────────────────────┘
                                           │
                              ┌────────────┴────────────┐
                              │    Anthropic Claude API  │
                              │    claude-sonnet-4-6     │
                              └─────────────────────────┘
```

---

## 2. 백엔드 아키텍처

### 2.1 프로세스 모델

단일 Python 프로세스. 모든 컴포넌트가 하나의 이벤트 루프 내에서 `asyncio` 태스크로 실행됩니다 — 스레드 없음, 서브프로세스 없음.

```
FastAPI 프로세스 (uvicorn)
│
├── asyncio 태스크: simulation_loop()      ← 10Hz 틱
├── asyncio 태스크: broadcast_loop()       ← EventBus를 WS 클라이언트로 드레인
└── asyncio 태스크: orchestrator.start()  ← ANOMALY_DETECTED 수신 대기
      └── asyncio.create_task: _run_chain()  ← 이상 발생마다 생성, 논블로킹
```

### 2.2 EventBus

`asyncio.Queue`를 사용한 인프로세스 pub/sub. 발행자는 `bus.publish(event)`를 호출합니다. 구독자는 `bus.subscribe()`를 호출하여 전용 `Queue` 인스턴스를 받습니다. 각 구독자가 자체 큐를 가지므로, 느린 소비자(예: Claude API를 호출 중인 오케스트레이터)가 브로드캐스트 루프를 블로킹할 수 없습니다.

```python
class EventBus:
    def __init__(self):
        self._queues: list[asyncio.Queue] = []

    def subscribe(self) -> asyncio.Queue: ...
    async def publish(self, event: Any) -> None: ...
```

**이벤트 유형:**
| 이벤트 유형 | 발행자 | 구독자 |
|---|---|---|
| `sensor_update` | SensorSimulator | broadcast_loop |
| `anomaly_detected` | SensorSimulator | AgentOrchestrator |

### 2.3 SensorSimulator

결정론적이지만 무작위화된 센서 데이터를 생성합니다.

- **정상 범위**: 진동 20~80 Hz, 온도 40~90°C, 전류 5~30A
- **고장 범위**: 진동 120~200 Hz, 온도 110~150°C, 전류 40~60A
- **고장 주입**: 한 번에 하나의 기계, 60~120초마다, 30초 지속
- **로봇 위치**: MVP에서는 정적 (에이전트 B가 파견할 때까지 위치 변경 없음)

### 2.4 AgentOrchestrator

`agent_a → agent_b → agent_c`를 논블로킹 `asyncio.create_task()`로 실행합니다. 에이전트 체인 실행 중에도 시뮬레이션 루프와 WebSocket 브로드캐스트는 전속으로 계속됩니다.

체인 실행 시 각 단계마다 WebSocket 메시지를 발행합니다:
1. `alert` → 프론트엔드에 AlertBanner 표시
2. `agent_event {A, running}` → Agent Panel에 스피너 표시
3. `agent_event {A, complete, summary}` → Agent Panel에 결과 표시
4. `agent_event {B, running}` → ...
5. `agent_event {B, complete, summary}`
6. `robot_dispatch` → Three.js 로봇 애니메이션
7. `agent_event {C, running}`
8. `agent_event {C, complete, summary}` → RICE 보고서 표시

### 2.5 파일 구조

```
backend/
├── main.py                    # FastAPI 앱, 라이프스팬 연결
├── requirements.txt
├── .env                       # ANTHROPIC_API_KEY (커밋 제외)
├── gateway/
│   ├── event_bus.py           # asyncio.Queue pub/sub
│   └── ws_gateway.py          # WebSocket 연결 관리자
├── simulator/
│   ├── models.py              # Pydantic: MachineState, RobotState, SensorSnapshot
│   └── sensor_simulator.py   # 10Hz 틱, 고장 주입
├── agents/
│   ├── orchestrator.py        # 체인 코디네이터
│   ├── agent_a.py             # 진단 (Claude API)
│   ├── agent_b.py             # 라우팅 (Claude API)
│   └── agent_c.py             # RICE 의사결정 (Claude API)
└── tests/
    ├── test_models.py
    ├── test_simulator.py
    └── test_agents.py
```

---

## 3. 프론트엔드 아키텍처

### 3.1 3계층 렌더링 모델

프론트엔드에는 세 개의 독립적인 렌더링 레이어가 있습니다. 16ms 프레임 예산 경쟁을 피하기 위해 의도적으로 분리되어 있습니다.

| 레이어 | 기술 | 업데이트 트리거 | 상태 경로 |
|---|---|---|---|
| 3D 공장 바닥 | Three.js (WebGL) | `requestAnimationFrame` (60fps) | `useRef` — React 완전 우회 |
| 센서 차트 | ECharts (Canvas) | Zustand 구독, 250ms 스로틀 | Zustand `machines[id].history` |
| Agent Panel + 알림 | React DOM | Zustand 구독, 이벤트 기반 | Zustand `agentEvents`, `activeAlert` |

**핵심 설계 결정:** 로봇 위치는 10Hz로 업데이트됩니다. 이를 Zustand에 기록하면 초당 10회 React 리렌더링이 발생하여 전체 컴포넌트 트리가 재조정됩니다. 대신, `useWebSocket`이 위치 업데이트를 `robotPosRef`(`useRef`)에 직접 기록하고, Three.js의 `requestAnimationFrame` 루프가 이 ref를 읽습니다. React는 핫 패스에 전혀 관여하지 않습니다.

### 3.2 데이터 흐름

```
WebSocket 메시지 도착
        │
        ▼
ws.onmessage → queueRef[]에 푸시    ← 블로킹 없음, O(1)
        │
        ▼
requestAnimationFrame drain()
        │
        ├── sensor_update
        │     ├── robotPosRef.current[id] = {x, y}     ← Three.js가 읽음
        │     ├── machineMeshesRef[id].material = ...   ← 메시 직접 업데이트
        │     └── store.applySnapshot()                 ← Zustand: 이력 추가
        │
        ├── robot_dispatch
        │     └── store.setDispatchCommand()            ← Agent Panel
        │
        ├── agent_event
        │     └── store.addAgentEvent()                 ← Agent Panel
        │
        └── alert
              └── store.setActiveAlert()                ← AlertBanner
```

### 3.3 Zustand 스토어

```typescript
interface FactoryStore {
  machines: Record<MachineId, MachineState>      // .history 링 버퍼 포함
  robots: Record<RobotId, RobotState>            // 위치가 아닌 상태만
  agentEvents: AgentEvent[]                      // 추가 전용, UI에 최근 9개 표시
  activeAlert: Alert | null
  dispatchCommand: DispatchCommand | null
}
```

`MachineState.history`는 300포인트(10Hz에서 30초)로 캡핑된 `[ts, vibration][]` 링 버퍼입니다. `vibration`만 차트로 표시되며, `temperature`와 `current`는 향후 확장을 위해 보존됩니다.

### 3.4 Three.js 메모리 관리

**지오메트리 및 머티리얼 캐시** — 모든 `THREE.BufferGeometry`와 `THREE.Material`은 정확히 한 번만 생성되어 모듈 수준의 `Map`에 저장됩니다. 모든 기계와 로봇 메시는 캐시를 통해 지오메트리 인스턴스를 공유합니다.

```
geoCache: Map<"machine" | "robot", THREE.BufferGeometry>
matCache: Map<"machine_normal" | "machine_degraded" | "machine_fault" | "robot", THREE.Material>
```

**언마운트 시 dispose** — `disposeScene()`이 `useEffect` 클린업에서 호출됩니다:
1. `scene.traverse()` → 모든 메시에 `geometry.dispose()` + `material.dispose()`
2. `renderer.dispose()`
3. `renderer.forceContextLoss()` — OS에 WebGL 컨텍스트 반환

**`forceContextLoss()`가 필요한 이유?** 브라우저는 페이지당 활성 WebGL 컨텍스트 수를 제한합니다(일반적으로 8~16개). 명시적 컨텍스트 해제 없이는, React StrictMode의 이중 호출이나 핫 리로드로 이 한도를 소진할 수 있습니다.

### 3.5 파일 구조

```
frontend/
├── app/
│   ├── layout.tsx             # 루트 레이아웃, Tailwind
│   └── page.tsx               # 레이아웃 셸, canvasRef와 모든 훅 소유
├── components/
│   ├── FactoryCanvas.tsx      # <canvas> 렌더링, canvasRef를 prop으로 수신
│   ├── SensorChart.tsx        # ECharts 라인 차트, 기계당 하나
│   ├── AgentPanel.tsx         # 에이전트 체인 상태 + RICE 보고서 표시
│   └── AlertBanner.tsx        # 알림 오버레이
├── hooks/
│   ├── useWebSocket.ts        # WS 연결, 메시지 큐, RAF 드레인
│   └── useThreeScene.ts       # Three.js 초기화, 애니메이션 루프, dispose
├── store/
│   └── factoryStore.ts        # Zustand 스토어 + applySnapshot 리듀서
├── lib/
│   ├── types.ts               # 공유 TypeScript 인터페이스 (백엔드 모델 미러링)
│   └── threeHelpers.ts        # 지오메트리 캐시, 머티리얼 캐시, disposeScene
└── __tests__/
    └── factoryStore.test.ts
```

---

## 4. 데이터 계약

모든 WebSocket 메시지는 이 봉투 구조를 사용합니다:

```typescript
type WSMessage =
  | { type: "sensor_update";  payload: SensorSnapshot }
  | { type: "robot_dispatch"; payload: DispatchCommand }
  | { type: "agent_event";    payload: AgentEvent }
  | { type: "alert";          payload: Alert }
```

### SensorSnapshot
```typescript
{
  ts: number                                    // unix ms
  machines: Record<string, {
    vibration: number                           // Hz
    temperature: number                         // °C
    current: number                             // A
    status: "normal" | "degraded" | "fault"
  }>
  robots: Record<string, {
    x: number                                   // 0~20 격자 단위
    y: number
    heading: number                             // 도(degree)
    status: "idle" | "moving" | "dispatched" | "arrived"
  }>
}
```

### DispatchCommand
```typescript
{
  robotId: string
  targetMachineId: string
  path: [number, number][]                      // 경유지 [[x,y], ...]
  estimatedArrival: number                      // 초
}
```

### AgentEvent
```typescript
{
  agentId: "A" | "B" | "C"
  status: "running" | "complete" | "error"
  summary: string                               // 사람이 읽을 수 있는 Claude 출력
  ts: number
}
```

---

## 5. 에이전트 아키텍처

### 5.1 에이전트 설계 원칙

- 각 에이전트는 **무상태 async 함수**: 입력 데이터 + Anthropic 클라이언트를 받아 구조화된 출력 반환
- 모든 에이전트는 동일한 모델 사용: `claude-sonnet-4-6`
- 모든 에이전트는 실패 시 타입화된 폴백 반환을 포함한 **10초 타임아웃** 보유
- **정규식 JSON 파싱**으로 응답 추출 — Claude가 JSON을 설명 텍스트로 감싸는 경우 처리
- 에이전트 프레임워크(LangChain 등) 없음 — 순수 Python + `anthropic` SDK

### 5.2 에이전트 A — 진단

**입력:** 기계 ID + 30초 센서 이력 (틱당 ts, 진동, 온도, 전류)  
**출력:** `AnomalyReport { severity, classification, affected_components, confidence }`  
**프롬프트 전략:** 컴팩트한 센서 JSON 배열 제공, 구조화된 JSON으로 분류 요청. 모델에 JSON만 반환하도록 지시.

### 5.3 에이전트 B — 라우팅

**입력:** 에이전트 A 보고서 + 현재 로봇 위치 및 상태  
**출력:** `DispatchPlan { robotId, path: [[x,y]...], eta_seconds }`  
**프롬프트 전략:** 20×20 격자 설명, 좌표와 함께 유휴 로봇 나열, 가장 가까운 로봇 선택 및 3~5개 경유지 경로 요청.

### 5.4 에이전트 C — 의사결정 (RICE)

**입력:** 에이전트 A 보고서 + 에이전트 B 파견 계획  
**출력:** `{ recommendation, rice_scores: { immediate, scheduled, bypass }, rationale }`  
**프롬프트 전략:** 프롬프트에 RICE 공식 정의 포함. 고장 컨텍스트와 ETA 제공. 점수와 최종 권고사항을 포함한 세 가지 옵션 비교 요청.

### 5.5 체인 실행

```python
async def _run_chain(machine_id: str):
    report   = await run_agent_a(machine_id, history, client)
    dispatch = await run_agent_b(machine_id, report, robots, client)
    rice     = await run_agent_c(machine_id, report, dispatch, client)
```

체인은 `asyncio.create_task()`로 실행됩니다 — Claude API 레이턴시와 무관하게 시뮬레이션 루프와 WebSocket 브로드캐스트는 절대 블로킹되지 않습니다.

---

## 6. 배포 아키텍처

```
인터넷
    │
    ├── https://<project>.vercel.app     ← 프론트엔드 (Vercel)
    │       Next.js 정적 + SSR
    │       NEXT_PUBLIC_WS_URL → wss://backend
    │
    └── https://<project>.up.railway.app ← 백엔드 (Railway)
            FastAPI + uvicorn
            ANTHROPIC_API_KEY (환경 변수)
            /health ← UptimeRobot이 5분마다 핑
```

### 환경 변수

| 변수 | 서비스 | 설명 |
|---|---|---|
| `ANTHROPIC_API_KEY` | 백엔드 | Claude API 키 — 프론트엔드에 절대 노출 금지 |
| `NEXT_PUBLIC_WS_URL` | 프론트엔드 | Railway 백엔드 WebSocket 엔드포인트의 `wss://` URL |

### 서비스 유지 전략

Railway 무료 티어는 약 10분 비활성 후 서비스를 일시 중단합니다. UptimeRobot(무료 플랜)이 5분마다 `GET /health`를 핑합니다. FastAPI의 `/health` 핸들러는 즉시 반환합니다(`{"status":"ok","clients":<n>}`) — DB 쿼리 없음, 사이드 이펙트 없음.

---

## 7. 성능 특성

| 우려사항 | 해결책 | 예상 결과 |
|---|---|---|
| 10Hz WebSocket → React 리렌더링 | RAF 드레인 큐 + robotPosRef 우회 | 위치 업데이트로 인한 React 리렌더링 제로 |
| 10Hz ECharts 리드로우 | 4Hz(250ms 게이트)로 스로틀 | 초당 4회 ECharts 리드로우, 육안으로 인식 불가 |
| 24시간 Three.js GPU 메모리 | 지오메트리/머티리얼 캐시 + 언마운트 시 dispose | 메모리 안정적; 누적 없음 |
| Claude API 레이턴시 (호출당 3~8초) | 논블로킹 asyncio.create_task + 스트리밍 에이전트 상태 | 센서 스트림 무중단; UI에 실시간 진행 표시 |
| WebSocket 버스트 (재연결) | 큐가 버스트 흡수; 다음 프레임에 드레인 | 메시지 손실 없음, 끊김 없음 |

---

## 8. 핵심 설계 결정

### 직접 함수 호출 대신 EventBus를 사용하는 이유
시뮬레이션 루프는 WebSocket 게이트웨이(빠른 경로)와 에이전트 오케스트레이터(느린 경로, Claude API 호출 중 블로킹 가능)에 동시에 알림을 보내야 합니다. EventBus는 각 구독자에게 자체 큐를 제공하므로 느린 구독자가 빠른 구독자를 블로킹하지 않습니다.

### Zustand 대신 로봇 위치에 ref를 사용하는 이유
Zustand는 모든 상태 쓰기 시 React 재조정을 트리거합니다. 10Hz에서 로봇 3개는 초당 30회의 잠재적 리렌더링입니다. Three.js의 `requestAnimationFrame` 루프는 React와 독립적으로 실행됩니다 — ref에서 읽는 것은 비용이 제로입니다.

### Next.js API 라우트 대신 별도 FastAPI 백엔드를 사용하는 이유
Next.js Vercel 배포는 서버리스 함수에 10초 실행 제한이 있는데, 이는 정확히 우리의 Claude API 타임아웃 예산입니다. Railway의 영구 FastAPI 프로세스에는 그런 제한이 없고, WebSocket 연결을 무기한 유지하며, asyncio 시뮬레이션 루프를 지속적으로 실행합니다.

### Opus 대신 `claude-sonnet-4-6`을 사용하는 이유
Sonnet은 구조화된 JSON 추출 작업(고장 분류, 좌표 라우팅, RICE 점수 산정)에 충분한 추론 품질을 제공하면서 레이턴시와 비용이 현저히 낮습니다. Opus는 이 잘 프롬프팅된 제한적 작업들에서 출력 품질의 의미 있는 개선 없이 레이턴시만 추가합니다.
