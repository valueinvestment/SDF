# 에이전트 스킬 레퍼런스
# SDF 디지털 트윈 멀티 에이전트 시뮬레이터

오케스트레이션 체인의 세 가지 AI 에이전트의 목적, 입력, 출력, 프롬프트, 제약사항, 장애 모드를 정의합니다.

---

## 개요

모든 에이전트는 다음 속성을 공유합니다:

| 속성 | 값 |
|---|---|
| 모델 | `claude-sonnet-4-6` |
| 타임아웃 | 호출당 10초 |
| 출력 형식 | 구조화된 JSON (응답 텍스트에서 정규식 추출) |
| 장애 모드 | 타입화된 폴백 구조체 반환; 체인 계속 실행 |
| 클라이언트 | `anthropic.AsyncAnthropic` (비동기, 논블로킹) |

체인은 순차적으로 실행됩니다: **A → B → C**. 각 에이전트는 이전 에이전트의 출력을 입력 컨텍스트로 받습니다. 이전 에이전트가 폴백을 반환해도 어떤 에이전트도 건너뛰지 않습니다 — 체인은 항상 완료까지 실행됩니다.

---

## 에이전트 A — 진단 (Diagnostic)

**목적:** 고장 기계에 대한 30초 센서 윈도우를 분석합니다. 고장 유형, 심각도, 영향 받는 부품을 분류합니다. 에이전트 B를 위한 구조화된 이상 보고서를 생성합니다.

### 입력
```python
machine_id: str             # 예: "M3"
sensor_history: list[dict]  # 최근 30 틱: [{ts, vibration, temperature, current}, ...]
```

### 출력
```python
@dataclass
class AnomalyReport:
    severity: str              # "low" | "medium" | "high" | "unknown"
    classification: str        # 예: "bearing_fault", "overheating", "motor_surge"
    affected_components: list[str]  # 예: ["spindle", "bearing"]
    confidence: float          # 0.0 ~ 1.0
    fallback: bool             # Claude 호출 타임아웃 또는 파싱 실패 시 True
```

### 프롬프트 템플릿
```
You are a factory equipment diagnostics expert.

Machine ID: {machine_id}
Sensor readings (last 30 ticks, each: {ts, vibration_hz, temperature_c, current_a}):
{history_json}

Analyze the sensor data and identify the anomaly.
Return ONLY valid JSON with no other text:
{"severity": "low"|"medium"|"high", "classification": "<fault type>",
 "affected_components": ["<component>"], "confidence": <0.0-1.0>}
```

### 프롬프트 설계 노트
- 센서 이력은 토큰 사용량 최소화를 위해 컴팩트 JSON(`separators=(",", ":")`)으로 직렬화
- "Return ONLY valid JSON"은 Claude가 출력을 설명 텍스트로 감싸는 경향을 감소시킴
- Claude가 설명을 추가하더라도, 정규식 추출(`r'\{[^{}]+\}'`)이 JSON을 복구

### 장애 모드
| 조건 | 동작 |
|---|---|
| `asyncio.timeout` (10초) | `AnomalyReport(severity="unknown", fallback=True)` 반환 |
| JSON 파싱 오류 | `AnomalyReport(severity="unknown", classification="parse_error", fallback=True)` 반환 |
| Claude가 예상치 못한 구조 반환 | `parse_agent_a_response()`가 기본값으로 `.get()` 사용; 크래시 없음 |

### WebSocket 발행
```
agent_event { agentId: "A", status: "running", summary: "" }
agent_event { agentId: "A", status: "complete", summary: "bearing_fault (high severity, 92% confidence)" }
```
폴백 시: `status: "error"` + 폴백 이유 설명 summary.

---

## 에이전트 B — 라우팅 (Routing)

**목적:** 에이전트 A의 이상 보고서를 받아 가장 가까운 사용 가능한(유휴) 로봇을 선택하고, 고장 기계까지의 경유지 경로를 계산합니다. Three.js 애니메이션과 에이전트 C 평가를 위한 파견 계획을 생성합니다.

### 입력
```python
machine_id: str           # 수리가 필요한 기계
report: AnomalyReport     # 에이전트 A로부터
robot_states: dict        # {robot_id: {x, y, status}} — 현재 스냅샷
```

### 출력
```python
@dataclass
class DispatchPlan:
    robotId: str             # 예: "R2"
    path: list[list[float]]  # 경유지 [[x,y], ...], 3~5개 포인트
    eta_seconds: float       # 예상 이동 시간
    reasoning: str           # 간단한 설명 (Agent Panel에 표시)
    fallback: bool
```

### 프롬프트 템플릿
```
You are a factory floor robot dispatch system.

Factory grid: 20x20 units.
Faulted machine: {machine_id} at position {machine_pos}.
Anomaly: {classification} (severity: {severity})

Available idle robots:
{idle_robots_json}

Select the nearest idle robot and compute a direct waypoint path
(3-5 waypoints) to the machine.
Return ONLY valid JSON:
{"robotId": "<id>", "path": [[x,y],...], "eta_seconds": <float>,
 "reasoning": "<brief>"}
```

### 프롬프트 설계 노트
- `robot_states`에서 유휴 로봇이 없으면, 합성 폴백 항목 `[{id: "R1", x: 10, y: 10}]`가 주입됩니다 — 에이전트 B는 항상 선택할 로봇이 하나 이상 있음
- 기계 위치는 하드코딩된 상수(`MACHINE_POSITIONS` 딕셔너리); 상태 조회 불필요
- 경로는 의도적으로 단순(3~5개 경유지, 거의 직선) — A* 경로 탐색은 Post-MVP 업그레이드 (IDEAS.md R-01 참조)

### 장애 모드
| 조건 | 동작 |
|---|---|
| `asyncio.timeout` (10초) | `DispatchPlan(robotId="R1", path=[], eta_seconds=10.0, fallback=True)` 반환 |
| JSON 파싱 오류 | 동일한 폴백 |
| 경로가 빈 `[]` | Three.js 로봇 애니메이션 없음(제자리 유지); 체인은 에이전트 C로 계속 |

### WebSocket 발행
```
agent_event  { agentId: "B", status: "running", summary: "" }
agent_event  { agentId: "B", status: "complete", summary: "Dispatching R2 → M3 (ETA 6s)" }
robot_dispatch { robotId: "R2", targetMachineId: "M3", path: [[5,5],[7,3]], estimatedArrival: 6.0 }
```
`robot_dispatch`는 에이전트 B 완료 후, 에이전트 C 시작 전에 즉시 발행됩니다 — 에이전트 C 계산 중에 Three.js 애니메이션이 시작됩니다.

---

## 에이전트 C — 의사결정 (Decision)

**목적:** 고장 분류와 파견 계획을 받아 세 가지 대응 옵션에 대한 RICE 점수를 계산하고 최선의 옵션을 권고합니다. Agent Panel에 표시할 구조화된 의사결정 보고서를 생성합니다.

### 입력
```python
machine_id: str
report: AnomalyReport      # 에이전트 A로부터
dispatch: DispatchPlan     # 에이전트 B로부터
```

### 출력
```python
{
    "recommendation": str          # "immediate_repair" | "scheduled_maintenance" | "temporary_bypass"
    "rice_scores": {
        "immediate":  RICEScore,
        "scheduled":  RICEScore,
        "bypass":     RICEScore,
    }
    "rationale": str               # 2~3문장 설명
    "fallback": bool
}

# RICEScore 형태:
{
    "reach":      int     # 1~10: 영향 받는 생산 단위 수
    "impact":     int     # 1~10: 운영에 미치는 영향 심각도
    "confidence": float   # 0~1: 추정치의 확실성
    "effort":     int     # 1~10: 구현 비용/시간
    "score":      float   # reach * impact * confidence / effort
}
```

### 프롬프트 템플릿
```
You are a factory operations decision analyst.

Faulted machine: {machine_id}
Fault classification: {classification} (severity: {severity}, confidence: {confidence})
Repair robot dispatched: {robotId}, ETA: {eta_seconds:.0f} seconds

Evaluate three action options using RICE scoring
(score = reach * impact * confidence / effort):
1. immediate_repair — dispatch robot now, halt machine
2. scheduled_maintenance — queue for next maintenance window
3. temporary_bypass — reroute production, defer repair

Return ONLY valid JSON (no extra text):
{
  "recommendation": "<option_key>",
  "rice_scores": {
    "immediate":  {"reach": <1-10>, "impact": <1-10>, "confidence": <0-1>,
                   "effort": <1-10>, "score": <float>},
    "scheduled":  {"reach": ..., "impact": ..., "confidence": ...,
                   "effort": ..., "score": ...},
    "bypass":     {"reach": ..., "impact": ..., "confidence": ...,
                   "effort": ..., "score": ...}
  },
  "rationale": "<2-3 sentences>"
}
```

### 프롬프트 설계 노트
- RICE 공식이 프롬프트에 명시적으로 정의됩니다 — Claude가 점수 산정 방식을 추측하지 않도록
- 세 개의 고정 옵션 키(`immediate_repair`, `scheduled_maintenance`, `temporary_bypass`)로 일관된 파싱 보장
- 중첩된 RICE JSON 구조를 수용하기 위해 `max_tokens=512` (A와 B보다 높음)

### 장애 모드
| 조건 | 동작 |
|---|---|
| `asyncio.timeout` (10초) | `{recommendation: "scheduled_maintenance", fallback: True}` 반환 |
| JSON 파싱 오류 | 동일한 폴백 |
| RICE 필드 누락 | `parse_agent_c_response()`가 기본값으로 `.get()` 사용 |

### WebSocket 발행
```
agent_event { agentId: "C", status: "running", summary: "" }
agent_event { agentId: "C", status: "complete",
              summary: "Recommendation: immediate_repair. High severity fault on M3 requires
                        immediate intervention to prevent production line stoppage. RICE
                        score (24.0) favors immediate action over scheduled maintenance (19.2)." }
```

---

## 체인 조정

### 오케스트레이터 역할
`AgentOrchestrator`가 체인을 조정합니다. 비즈니스 로직을 포함하지 않습니다 — 에이전트 함수를 호출하고 호출 사이에 WebSocket 발행을 처리합니다.

```python
async def _run_chain(machine_id: str):
    # 1. 알림 발행
    await gateway.broadcast({ type: "alert", payload: {...} })

    # 2. 에이전트 A
    await emit("A", "running")
    report = await run_agent_a(machine_id, history, client)
    await emit("A", "complete" | "error", summary)

    # 3. 에이전트 B
    await emit("B", "running")
    dispatch = await run_agent_b(machine_id, report, robots, client)
    await emit("B", "complete" | "error", summary)
    await gateway.broadcast({ type: "robot_dispatch", payload: dispatch })  # C 이전에 발행

    # 4. 에이전트 C
    await emit("C", "running")
    rice = await run_agent_c(machine_id, report, dispatch, client)
    await emit("C", "complete" | "error", summary)
```

### 체인 불변 조건
- 개별 에이전트의 폴백 여부와 무관하게 체인은 항상 A → B → C 순으로 실행
- 에이전트 B는 항상 `AnomalyReport`를 받음 (폴백일 수 있음); 에이전트 C는 항상 둘 다 받음
- `robot_dispatch`는 C 이후가 아닌 B 완료 후 브로드캐스트 — 로봇 애니메이션이 즉시 시작
- 체인은 `asyncio.create_task()`로 실행 — 체인 실행 중 새 고장 주입이 발생하면 두 번째 동시 체인이 생성됨 (로봇 위치에 대해 마지막 쓰기 우선)

### 체인 확장 방법

새 에이전트 추가 시(예: 에이전트 D — 예측 정비):

1. `run_agent_d(...)`와 `parse_agent_d_response(...)`가 있는 `backend/agents/agent_d.py` 생성
2. `backend/tests/test_agents.py`에 단위 테스트 추가
3. 에이전트 C 이후 `orchestrator._run_chain()`에 `await run_agent_d(...)` 호출 추가
4. 출력에 전용 프론트엔드 핸들러가 필요한 경우 새 `WSMessage` 유형 추가
5. 새 에이전트의 출력을 렌더링하도록 `AgentPanel.tsx` 확장

EventBus, WebSocketGateway, SensorSimulator는 변경 불필요.

---

## 프롬프트 엔지니어링 가이드라인

### 구조화된 출력 에이전트 (세 개 모두):
1. 프롬프트에 정확한 JSON 스키마 정의 — 필드명, 타입, 값 범위
2. 마지막 지시로 "Return ONLY valid JSON with no other text" 작성
3. 안전망으로 정규식 추출 사용 — Claude는 지시에도 불구하고 때로 설명을 추가함
4. `max_tokens`를 타이트하게 유지 (A와 B는 256, C는 512) — 간결한 응답 강제

### 향후 스트리밍 에이전트용 (IDEAS.md A-02 참조):
1. `client.messages.create()` 대신 `client.messages.stream()` 사용
2. 서버 사이드에서 청크 누적; WebSocket으로 부분 JSON 발행
3. 프론트엔드는 `useRef` 버퍼를 사용하여 Agent Panel에서 스트리밍 텍스트 렌더링

### 체인 실행당 토큰 비용 추정:
| 에이전트 | 입력 토큰 (추정) | 출력 토큰 (추정) | 비용 (Sonnet 4.6) |
|---|---|---|---|
| A | ~400 | ~80 | ~$0.001 |
| B | ~250 | ~80 | ~$0.001 |
| C | ~350 | ~200 | ~$0.002 |
| **체인 합계** | **~1,000** | **~360** | **~$0.004** |

90초마다 1회 체인 실행 시: 연속 운영 시간당 약 $0.16. 데모 용도로는 무시할 수 있는 수준.
