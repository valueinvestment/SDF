# Agent Skills Reference
# SDF Digital Twin Multi-Agent Simulator

Defines the three AI agents in the orchestration chain: their purpose, inputs, outputs, prompts, constraints, and failure modes.

---

## Overview

All agents share these properties:

| Property | Value |
|---|---|
| Model | `claude-sonnet-4-6` |
| Timeout | 10 seconds per call |
| Output format | Structured JSON (regex-extracted from response text) |
| Failure mode | Returns a typed fallback struct; chain continues |
| Client | `anthropic.AsyncAnthropic` (async, non-blocking) |

The chain fires sequentially: **A → B → C**. Each agent receives the previous agent's output as input context. No agent is skipped even if a prior agent returned a fallback — the chain always runs to completion.

---

## Agent A — Diagnostic

**Purpose:** Analyze a 30-second sensor window for a faulted machine. Classify the fault type, severity, and affected components. Produce a structured anomaly report for Agent B.

### Input
```python
machine_id: str           # e.g., "M3"
sensor_history: list[dict]  # last 30 ticks: [{ts, vibration, temperature, current}, ...]
```

### Output
```python
@dataclass
class AnomalyReport:
    severity: str              # "low" | "medium" | "high" | "unknown"
    classification: str        # e.g., "bearing_fault", "overheating", "motor_surge"
    affected_components: list[str]  # e.g., ["spindle", "bearing"]
    confidence: float          # 0.0 – 1.0
    fallback: bool             # True if Claude call timed out or parse failed
```

### Prompt Template
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

### Prompt Design Notes
- Sensor history is serialized as compact JSON (`separators=(",", ":")`) to minimize token usage
- "Return ONLY valid JSON" reduces Claude's tendency to wrap output in explanation text
- Even if Claude adds explanation, regex extraction (`r'\{[^{}]+\}'`) recovers the JSON

### Failure Modes
| Condition | Behavior |
|---|---|
| `asyncio.timeout` (10s) | Returns `AnomalyReport(severity="unknown", fallback=True)` |
| JSON parse error | Returns `AnomalyReport(severity="unknown", classification="parse_error", fallback=True)` |
| Claude returns unexpected structure | `parse_agent_a_response()` uses `.get()` with defaults; no crash |

### WebSocket Emissions
```
agent_event { agentId: "A", status: "running", summary: "" }
agent_event { agentId: "A", status: "complete", summary: "bearing_fault (high severity, 92% confidence)" }
```
On fallback: `status: "error"` with summary explaining the fallback.

---

## Agent B — Routing

**Purpose:** Given the anomaly report from Agent A, select the nearest available (idle) robot and compute a waypoint path to the faulted machine. Produce a dispatch plan for Three.js to animate and Agent C to evaluate.

### Input
```python
machine_id: str           # which machine needs repair
report: AnomalyReport     # from Agent A
robot_states: dict        # {robot_id: {x, y, status}} — current snapshot
```

### Output
```python
@dataclass
class DispatchPlan:
    robotId: str           # e.g., "R2"
    path: list[list[float]]  # waypoints [[x,y], ...], 3–5 points
    eta_seconds: float     # estimated travel time
    reasoning: str         # brief explanation (shown in Agent Panel)
    fallback: bool
```

### Prompt Template
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

### Prompt Design Notes
- If no idle robots are found in `robot_states`, a synthetic fallback entry `[{id: "R1", x: 10, y: 10}]` is injected — Agent B always has at least one robot to choose from
- Machine positions are hardcoded constants (`MACHINE_POSITIONS` dict); no need to query state
- Path is intentionally simple (3–5 waypoints, straight-ish lines) — A* pathfinding is a post-MVP upgrade (see IDEAS.md R-01)

### Failure Modes
| Condition | Behavior |
|---|---|
| `asyncio.timeout` (10s) | Returns `DispatchPlan(robotId="R1", path=[], eta_seconds=10.0, fallback=True)` |
| JSON parse error | Same fallback |
| Path is empty `[]` | Three.js robot does not animate (stays in place); chain continues to Agent C |

### WebSocket Emissions
```
agent_event  { agentId: "B", status: "running", summary: "" }
agent_event  { agentId: "B", status: "complete", summary: "Dispatching R2 → M3 (ETA 6s)" }
robot_dispatch { robotId: "R2", targetMachineId: "M3", path: [[5,5],[7,3]], estimatedArrival: 6.0 }
```
`robot_dispatch` is emitted immediately after Agent B completes, before Agent C starts — so the Three.js animation begins while Agent C is still computing.

---

## Agent C — Decision

**Purpose:** Given the fault classification and dispatch plan, compute RICE scores for three response options and recommend the best one. Produce a structured decision report for display in the Agent Panel.

### Input
```python
machine_id: str
report: AnomalyReport      # from Agent A
dispatch: DispatchPlan     # from Agent B
```

### Output
```python
{
    "recommendation": str          # "immediate_repair" | "scheduled_maintenance" | "temporary_bypass"
    "rice_scores": {
        "immediate":  RICEScore,
        "scheduled":  RICEScore,
        "bypass":     RICEScore,
    }
    "rationale": str               # 2–3 sentence explanation
    "fallback": bool
}

# RICEScore shape:
{
    "reach":      int     # 1–10: how many production units affected
    "impact":     int     # 1–10: severity of impact on operations
    "confidence": float   # 0–1: certainty of estimates
    "effort":     int     # 1–10: cost/time to implement
    "score":      float   # reach * impact * confidence / effort
}
```

### Prompt Template
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

### Prompt Design Notes
- RICE formula is defined explicitly in the prompt — Claude should not guess the scoring methodology
- Three fixed option keys (`immediate_repair`, `scheduled_maintenance`, `temporary_bypass`) ensure consistent parsing
- `max_tokens=512` (higher than A and B) to accommodate the nested RICE JSON structure

### Failure Modes
| Condition | Behavior |
|---|---|
| `asyncio.timeout` (10s) | Returns `{recommendation: "scheduled_maintenance", fallback: True}` |
| JSON parse error | Same fallback |
| Missing RICE fields | `parse_agent_c_response()` uses `.get()` with defaults |

### WebSocket Emissions
```
agent_event { agentId: "C", status: "running", summary: "" }
agent_event { agentId: "C", status: "complete",
              summary: "Recommendation: immediate_repair. High severity fault on M3 requires
                        immediate intervention to prevent production line stoppage. RICE
                        score (24.0) favors immediate action over scheduled maintenance (19.2)." }
```

---

## Chain Coordination

### Orchestrator Responsibilities
The `AgentOrchestrator` coordinates the chain. It does not contain business logic — it calls agent functions and handles WebSocket emissions between calls.

```python
async def _run_chain(machine_id: str):
    # 1. Emit alert
    await gateway.broadcast({ type: "alert", payload: {...} })

    # 2. Agent A
    await emit("A", "running")
    report = await run_agent_a(machine_id, history, client)
    await emit("A", "complete" | "error", summary)

    # 3. Agent B
    await emit("B", "running")
    dispatch = await run_agent_b(machine_id, report, robots, client)
    await emit("B", "complete" | "error", summary)
    await gateway.broadcast({ type: "robot_dispatch", payload: dispatch })  # fire before C

    # 4. Agent C
    await emit("C", "running")
    rice = await run_agent_c(machine_id, report, dispatch, client)
    await emit("C", "complete" | "error", summary)
```

### Chain Invariants
- The chain always runs A → B → C regardless of individual agent fallback status
- Agent B always receives an `AnomalyReport` (may be fallback); Agent C always receives both
- `robot_dispatch` is broadcast after B completes, not after C — robot animation starts immediately
- The chain runs as `asyncio.create_task()` — a new fault injection while the chain is running spawns a second concurrent chain (last write wins on robot positions)

### Extending the Chain

To add a new agent (e.g., Agent D — Predictive Maintenance):

1. Create `backend/agents/agent_d.py` with `run_agent_d(...)` and `parse_agent_d_response(...)`
2. Add unit tests to `backend/tests/test_agents.py`
3. Add `await run_agent_d(...)` call to `orchestrator._run_chain()` after Agent C
4. Add new `WSMessage` type if the output needs a dedicated frontend handler
5. Extend `AgentPanel.tsx` to render the new agent's output

No changes needed to EventBus, WebSocketGateway, or SensorSimulator.

---

## Prompt Engineering Guidelines

### For structured output agents (all three):
1. Define the exact JSON schema in the prompt — field names, types, value ranges
2. Say "Return ONLY valid JSON with no other text" as the last instruction
3. Use regex extraction as a safety net — Claude sometimes adds explanation despite the instruction
4. Keep `max_tokens` tight (256 for A and B, 512 for C) — forces concise responses

### For future streaming agents (see IDEAS.md A-02):
1. Use `client.messages.stream()` instead of `client.messages.create()`
2. Accumulate chunks server-side; emit partial JSON over WebSocket
3. Frontend renders streaming text in the Agent Panel using a `useRef` buffer

### Token cost estimates per chain run:
| Agent | Input tokens (est.) | Output tokens (est.) | Cost (Sonnet 4.6) |
|---|---|---|---|
| A | ~400 | ~80 | ~$0.001 |
| B | ~250 | ~80 | ~$0.001 |
| C | ~350 | ~200 | ~$0.002 |
| **Total per chain** | **~1000** | **~360** | **~$0.004** |

At one chain run per 90 seconds: ~$0.16/hour of continuous operation. Negligible for demo use.
