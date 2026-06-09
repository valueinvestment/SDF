# AI Agents
# SDF Digital Twin Multi-Agent Simulator

세 AI 에이전트가 순차적으로 실행되는 체인입니다. 각 에이전트는 공장 이상 감지 이벤트에 반응하여 진단 → 대응 → 의사결정을 자동으로 수행합니다.

**공통 사양:**

| 항목 | 값 |
|---|---|
| 모델 | `claude-sonnet-4-6` |
| 타임아웃 | 60초 / 호출 |
| 출력 형식 | 구조화된 JSON (응답 텍스트에서 regex 추출) |
| 장애 처리 | 타입이 지정된 폴백 구조체 반환; 체인은 계속 실행 |
| 클라이언트 | `anthropic.AsyncAnthropic` (비동기, 논블로킹) |

체인은 항상 **A → B → C** 순서로 실행됩니다. 이전 에이전트가 폴백을 반환해도 체인은 끊기지 않습니다.

---

## Agent A — 이상 진단 (Diagnostic)

### 하는 일
공장 기계의 30초 센서 이력을 분석하여 **무슨 고장인지, 얼마나 심각한지, 어느 부품이 문제인지** 판단합니다.

진동(Hz), 온도(°C), 전류(A) 세 가지 센서 값의 시계열 패턴을 보고 베어링 마모, 과열, 모터 서지 등의 고장 유형을 분류합니다.

### 입력
```python
machine_id: str           # 고장 기계 ID (예: "M3", "press-1749375234123")
sensor_history: list[dict]  # 최근 30 틱: [{ts, vibration, temperature, current}, ...]
```

### 출력
```python
AnomalyReport(
    severity="low" | "medium" | "high",
    classification="bearing_fault" | "overheating" | "motor_surge" | ...,
    affected_components=["spindle", "bearing"],  # 문제 부품 목록
    confidence=0.92,  # 0.0 – 1.0
)
```

### WebSocket 이벤트
```
→ agent_event { agentId: "A", status: "running" }
→ agent_event { agentId: "A", status: "complete",
                summary: "bearing_fault (high severity, 92% confidence)" }
```

### 폴백 조건
| 상황 | 동작 |
|---|---|
| 60초 타임아웃 | `severity="unknown", fallback=True` 반환 |
| JSON 파싱 실패 | `classification="parse_error", fallback=True` 반환 |
| 기계가 더 이상 존재하지 않음 | 즉시 `"error"` 이벤트 발행 후 체인 종료 |

---

## Agent B — 로봇 파견 (Routing)

### 하는 일
Agent A의 진단 결과를 받아 **어떤 로봇을 어떤 경로로 보낼지** 결정합니다.

20×20 그리드 위의 모든 로봇 위치와 상태를 파악하고, 고장 기계에 가장 가까운 유휴(idle) 로봇을 선택하여 3–5개의 웨이포인트 경로를 계획합니다. 경로는 Agent B가 완료되는 즉시 Three.js 애니메이션에 사용됩니다.

### 입력
```python
machine_id: str        # 수리가 필요한 기계
report: AnomalyReport  # Agent A의 출력
robot_states: dict     # {robot_id: {x, y, status}} — 현재 스냅샷
```

### 출력
```python
DispatchPlan(
    robotId="R2",
    path=[[5, 5], [7, 3], [9, 3]],  # 웨이포인트 좌표 목록
    eta_seconds=6.0,
    reasoning="R2 is the closest idle robot at distance 5.8 units",
)
```

### WebSocket 이벤트
```
→ agent_event    { agentId: "B", status: "running" }
→ agent_event    { agentId: "B", status: "complete", summary: "Dispatching R2 → M3 (ETA 6s)" }
→ robot_dispatch { robotId: "R2", targetMachineId: "M3",
                   path: [[5,5],[7,3],[9,3]], estimatedArrival: 6.0 }
```

`robot_dispatch`는 Agent C가 시작되기 **전**에 먼저 발행됩니다. 로봇이 이동을 시작하는 동안 Agent C가 병렬로 분석을 진행합니다.

### 폴백 조건
| 상황 | 동작 |
|---|---|
| 유휴 로봇 없음 | 합성 더미 로봇(`R1`, x=10, y=10)을 주입하여 체인 계속 |
| 60초 타임아웃 | `robotId="R1", path=[], fallback=True` 반환 |
| 경로가 빈 배열 | Three.js 애니메이션 없이 체인은 계속 실행 |

---

## Agent C — RICE 의사결정 (Decision)

### 하는 일
Agent A의 고장 분류와 Agent B의 파견 계획을 종합하여 **세 가지 대응 옵션에 RICE 점수를 매기고 최선의 행동을 추천**합니다.

RICE = (Reach × Impact × Confidence) / Effort

세 가지 옵션을 평가합니다:
1. **즉시 수리 (immediate_repair)** — 로봇을 지금 보내고 기계를 정지
2. **계획 정비 (scheduled_maintenance)** — 다음 정기 점검 때까지 대기
3. **임시 우회 (temporary_bypass)** — 생산 경로를 변경하고 수리를 유예

### 입력
```python
machine_id: str
report: AnomalyReport   # Agent A 출력
dispatch: DispatchPlan  # Agent B 출력
```

### 출력
```python
{
    "recommendation": "immediate_repair",
    "rice_scores": {
        "immediate":  {"reach": 8, "impact": 9, "confidence": 0.92, "effort": 4, "score": 16.6},
        "scheduled":  {"reach": 8, "impact": 9, "confidence": 0.7,  "effort": 2, "score": 25.2},
        "bypass":     {"reach": 5, "impact": 6, "confidence": 0.8,  "effort": 3, "score": 8.0},
    },
    "rationale": "High severity bearing fault requires immediate intervention. RICE score
                  favors immediate repair (16.6) to prevent production line stoppage.",
}
```

### WebSocket 이벤트
```
→ agent_event { agentId: "C", status: "running" }
→ agent_event { agentId: "C", status: "complete",
                summary: "Recommendation: immediate_repair. High severity fault on M3
                          requires immediate intervention to prevent production stoppage." }
```

### 폴백 조건
| 상황 | 동작 |
|---|---|
| 60초 타임아웃 | `recommendation="scheduled_maintenance", fallback=True` 반환 |
| JSON 파싱 실패 | 동일 |
| RICE 필드 누락 | `.get()` 기본값으로 채움; 크래시 없음 |

---

## 체인 실행 흐름

```
[이상 감지 이벤트]
        │
        ▼
    alert 브로드캐스트
        │
        ▼
    Agent A (진단)
    └─ complete → AnomalyReport
        │
        ▼
    Agent B (파견)
    └─ complete → DispatchPlan
        │
        ├─── robot_dispatch 브로드캐스트  ← Three.js 로봇 애니메이션 시작
        │
        ▼
    Agent C (결정)
    └─ complete → RICE 추천 → Agent Panel에 표시
```

체인은 `asyncio.create_task()`로 실행됩니다. 체인이 실행되는 동안 시뮬레이션 루프와 WebSocket 브로드캐스트는 중단 없이 계속됩니다. 새 고장이 체인 실행 중에 발생하면 두 번째 체인이 독립적으로 병렬 실행됩니다.

---

## 에이전트 추가 방법

1. `backend/agents/agent_d.py` 생성 — `run_agent_d(...)`, `parse_agent_d_response(...)` 함수 작성
2. `backend/tests/test_agents.py`에 단위 테스트 추가
3. `orchestrator._run_chain()`에 `await run_agent_d(...)` 호출 추가 (Agent C 다음)
4. 새로운 출력 타입이 필요하면 `WSMessage` 유니온 타입 확장
5. `AgentPanel.tsx`에서 새 에이전트 ID 렌더링 추가

`EventBus`, `WebSocketGateway`, `SensorSimulator`는 수정 불필요.

---

## 프롬프트 설계 원칙

1. **JSON 스키마를 프롬프트에 명시** — 필드명, 타입, 값 범위를 모두 작성
2. **"Return ONLY valid JSON"을 마지막 지시로** — Claude가 설명 텍스트를 추가하는 경향 억제
3. **Regex 추출을 안전망으로** — `r'\{[^{}]+\}'`로 JSON을 복구 가능
4. **`max_tokens`를 타이트하게** — A·B는 256, C는 512 (중첩 RICE 구조 때문)

### 체인 실행당 토큰 비용 추정
| 에이전트 | 입력 토큰 | 출력 토큰 | 비용 (Sonnet 4.6) |
|---|---|---|---|
| A | ~400 | ~80 | ~$0.001 |
| B | ~250 | ~80 | ~$0.001 |
| C | ~350 | ~200 | ~$0.002 |
| **합계** | **~1,000** | **~360** | **~$0.004** |

90초마다 1회 실행 기준: 시간당 약 $0.16. 데모 용도로 무시할 수 있는 수준.
