# System Architecture
# SDF Digital Twin Multi-Agent Simulator

**Date:** 2026-05-27  
**Version:** 1.0

---

## 1. Overview

Two independently deployed services communicate over a single persistent WebSocket connection. The backend is the single source of truth for all factory state; the frontend is a pure consumer and renderer.

```
┌─────────────────────────────────────────────────────────┐
│                     FRONTEND (Vercel)                   │
│  Next.js 14 + TypeScript                                │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Three.js    │  │   ECharts    │  │  Agent Panel │  │
│  │  (WebGL)     │  │  (Canvas)    │  │  (React DOM) │  │
│  │  60fps loop  │  │  4Hz update  │  │  event-driven│  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         │                 │                  │          │
│         └─────────────────┴──────────────────┘          │
│                           │                             │
│                    Zustand Store                        │
│                    + robotPosRef (bypass)               │
│                           │                             │
│                    useWebSocket hook                    │
│                    (RAF drain queue)                    │
└───────────────────────────┬─────────────────────────────┘
                            │ WebSocket (wss://)
                            │ ~10Hz sensor stream
                            │ sparse agent events
┌───────────────────────────┴─────────────────────────────┐
│                     BACKEND (Railway)                   │
│  FastAPI + Python + asyncio                             │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │  SensorSimulator (asyncio task, 10Hz)            │   │
│  │  - 5 machines: vibration, temp, current          │   │
│  │  - 3 robots: x, y, heading, status               │   │
│  │  - fault injection every 60–120s                 │   │
│  └─────────────────────┬────────────────────────────┘   │
│                        │                                │
│                   EventBus (asyncio.Queue)              │
│                  /              \                       │
│  ┌──────────────┘                └────────────────┐     │
│  │  WebSocketGateway              AgentOrchestrator│     │
│  │  broadcast to all clients      (on ANOMALY)     │     │
│  └──────────────────────         └────────┬────────┘     │
│                                           │             │
│                                  Agent A → B → C        │
│                                  (Claude API calls)     │
└─────────────────────────────────────────────────────────┘
                                           │
                              ┌────────────┴────────────┐
                              │    Anthropic Claude API  │
                              │    claude-sonnet-4-6     │
                              └─────────────────────────┘
```

---

## 2. Backend Architecture

### 2.1 Process Model

Single Python process. All components run as `asyncio` tasks within one event loop — no threads, no subprocesses.

```
FastAPI process (uvicorn)
│
├── asyncio task: simulation_loop()      ← 10Hz tick
├── asyncio task: broadcast_loop()       ← drains EventBus to WS clients
└── asyncio task: orchestrator.start()  ← listens for ANOMALY_DETECTED
      └── asyncio.create_task: _run_chain()  ← spawned per anomaly, non-blocking
```

### 2.2 EventBus

In-process pub/sub using `asyncio.Queue`. Publishers call `bus.publish(event)`. Subscribers call `bus.subscribe()` which returns a dedicated `Queue` instance — each subscriber gets its own queue, so slow consumers (e.g., orchestrator running Claude API calls) cannot block the broadcast loop.

```python
class EventBus:
    def __init__(self):
        self._queues: list[asyncio.Queue] = []

    def subscribe(self) -> asyncio.Queue: ...
    async def publish(self, event: Any) -> None: ...
```

**Event types:**
| Event type | Publisher | Subscriber(s) |
|---|---|---|
| `sensor_update` | SensorSimulator | broadcast_loop |
| `anomaly_detected` | SensorSimulator | AgentOrchestrator |

### 2.3 SensorSimulator

Generates deterministic-but-randomized sensor data. Key behaviors:

- **Normal range**: vibration 20–80 Hz, temperature 40–90°C, current 5–30A
- **Fault range**: vibration 120–200 Hz, temperature 110–150°C, current 40–60A
- **Fault injection**: one machine at a time, every 60–120s, lasting 30s
- **Robot positions**: static in MVP (positions don't change until Agent B dispatches)

### 2.4 AgentOrchestrator

Runs `agent_a → agent_b → agent_c` as a non-blocking `asyncio.create_task()`. The simulation loop and WebSocket broadcast continue at full speed during agent chain execution.

Chain execution emits WebSocket messages at each step:
1. `alert` → frontend shows AlertBanner
2. `agent_event {A, running}` → Agent Panel shows spinner
3. `agent_event {A, complete, summary}` → Agent Panel shows result
4. `agent_event {B, running}` → ...
5. `agent_event {B, complete, summary}`
6. `robot_dispatch` → Three.js animates robot
7. `agent_event {C, running}`
8. `agent_event {C, complete, summary}` → RICE report visible

### 2.5 File Structure

```
backend/
├── main.py                    # FastAPI app, lifespan wiring
├── requirements.txt
├── .env                       # ANTHROPIC_API_KEY (not committed)
├── gateway/
│   ├── event_bus.py           # asyncio.Queue pub/sub
│   └── ws_gateway.py          # WebSocket connection manager
├── simulator/
│   ├── models.py              # Pydantic: MachineState, RobotState, SensorSnapshot
│   └── sensor_simulator.py   # 10Hz tick, fault injection
├── agents/
│   ├── orchestrator.py        # Chain coordinator
│   ├── agent_a.py             # Diagnostic (Claude API)
│   ├── agent_b.py             # Routing (Claude API)
│   └── agent_c.py             # RICE Decision (Claude API)
└── tests/
    ├── test_models.py
    ├── test_simulator.py
    └── test_agents.py
```

---

## 3. Frontend Architecture

### 3.1 Three-Layer Rendering Model

The frontend has three independent rendering layers. They are deliberately isolated to avoid competing for the 16ms frame budget.

| Layer | Technology | Update Trigger | State Path |
|---|---|---|---|
| 3D Factory Floor | Three.js (WebGL) | `requestAnimationFrame` (60fps) | `useRef` — bypasses React entirely |
| Sensor Charts | ECharts (Canvas) | Zustand subscription, throttled 250ms | Zustand `machines[id].history` |
| Agent Panel + Alerts | React DOM | Zustand subscription, event-driven | Zustand `agentEvents`, `activeAlert` |

**Critical design decision:** Robot positions update at 10Hz. Writing these to Zustand would trigger React re-renders 10 times/second, causing the entire component tree to re-reconcile. Instead, `useWebSocket` writes position updates directly to a `robotPosRef` (`useRef`), and the Three.js `requestAnimationFrame` loop reads from this ref. React is never involved in the hot path.

### 3.2 Data Flow

```
WebSocket message arrives
        │
        ▼
ws.onmessage → push to queueRef[]    ← never blocks, O(1)
        │
        ▼
requestAnimationFrame drain()
        │
        ├── sensor_update
        │     ├── robotPosRef.current[id] = {x, y}     ← Three.js reads this
        │     ├── machineMeshesRef[id].material = ...   ← direct mesh update
        │     └── store.applySnapshot()                 ← Zustand: history append
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

### 3.3 Zustand Store

```typescript
interface FactoryStore {
  machines: Record<MachineId, MachineState>      // includes .history ring buffer
  robots: Record<RobotId, RobotState>            // status only, not position
  agentEvents: AgentEvent[]                      // append-only, last 9 shown in UI
  activeAlert: Alert | null
  dispatchCommand: DispatchCommand | null
}
```

`MachineState.history` is a `[ts, vibration][]` ring buffer capped at 300 points (30 seconds at 10Hz). Only `vibration` is charted; `temperature` and `current` are available for future expansion.

### 3.4 Three.js Memory Management

**Geometry and material cache** — every `THREE.BufferGeometry` and `THREE.Material` is created exactly once and stored in a module-level `Map`. All machine and robot meshes share geometry instances via the cache.

```
geoCache: Map<"machine" | "robot", THREE.BufferGeometry>
matCache: Map<"machine_normal" | "machine_degraded" | "machine_fault" | "robot", THREE.Material>
```

**Dispose on unmount** — `disposeScene()` is called in the `useEffect` cleanup:
1. `scene.traverse()` → `geometry.dispose()` + `material.dispose()` on all meshes
2. `renderer.dispose()`
3. `renderer.forceContextLoss()` — releases the WebGL context to the OS

**Why `forceContextLoss()`?** Browsers limit the number of active WebGL contexts per page (typically 8–16). Without explicit context loss, React StrictMode's double-invocation or hot-reload can exhaust the limit.

### 3.5 File Structure

```
frontend/
├── app/
│   ├── layout.tsx             # Root layout, Tailwind
│   └── page.tsx               # Layout shell, owns canvasRef and all hooks
├── components/
│   ├── FactoryCanvas.tsx      # Renders <canvas>, receives canvasRef as prop
│   ├── SensorChart.tsx        # ECharts line chart, one per machine
│   ├── AgentPanel.tsx         # Agent chain status + RICE report display
│   └── AlertBanner.tsx        # Alert overlay
├── hooks/
│   ├── useWebSocket.ts        # WS connection, message queue, RAF drain
│   └── useThreeScene.ts       # Three.js init, animate loop, dispose
├── store/
│   └── factoryStore.ts        # Zustand store + applySnapshot reducer
├── lib/
│   ├── types.ts               # Shared TypeScript interfaces (mirrors backend models)
│   └── threeHelpers.ts        # Geometry cache, material cache, disposeScene
└── __tests__/
    └── factoryStore.test.ts
```

---

## 4. Data Contracts

All WebSocket messages use this envelope:

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
    x: number                                   // 0–20 grid units
    y: number
    heading: number                             // degrees
    status: "idle" | "moving" | "dispatched" | "arrived"
  }>
}
```

### DispatchCommand
```typescript
{
  robotId: string
  targetMachineId: string
  path: [number, number][]                      // waypoints [[x,y], ...]
  estimatedArrival: number                      // seconds
}
```

### AgentEvent
```typescript
{
  agentId: "A" | "B" | "C"
  status: "running" | "complete" | "error"
  summary: string                               // human-readable Claude output
  ts: number
}
```

---

## 5. Agent Architecture

### 5.1 Agent Design Principles

- Each agent is a **stateless async function**: receives input data + Anthropic client, returns structured output
- All agents use the same model: `claude-sonnet-4-6`
- All agents have a **10-second timeout** with a typed fallback return on failure
- Responses are extracted with **regex JSON parsing** — handles Claude wrapping JSON in explanation text
- No agent frameworks (LangChain, etc.) — plain Python + `anthropic` SDK

### 5.2 Agent A — Diagnostic

**Input:** Machine ID + 30-second sensor history (ts, vibration, temperature, current per tick)  
**Output:** `AnomalyReport { severity, classification, affected_components, confidence }`  
**Prompt strategy:** Provide compact sensor JSON array, ask for classification in structured JSON. Model is instructed to return only JSON.

### 5.3 Agent B — Routing

**Input:** Agent A report + current robot positions and statuses  
**Output:** `DispatchPlan { robotId, path: [[x,y]...], eta_seconds }`  
**Prompt strategy:** Describe the 20×20 grid, list idle robots with coordinates, ask for nearest-robot selection and 3–5 waypoint path.

### 5.4 Agent C — Decision (RICE)

**Input:** Agent A report + Agent B dispatch plan  
**Output:** `{ recommendation, rice_scores: { immediate, scheduled, bypass }, rationale }`  
**Prompt strategy:** Provide RICE formula definition in prompt. Give fault context and ETA. Ask for three-option comparison with scores and final recommendation.

### 5.5 Chain Execution

```python
async def _run_chain(machine_id: str):
    report   = await run_agent_a(machine_id, history, client)
    dispatch = await run_agent_b(machine_id, report, robots, client)
    rice     = await run_agent_c(machine_id, report, dispatch, client)
```

The chain runs as `asyncio.create_task()` — the simulation loop and WebSocket broadcast are never blocked regardless of Claude API latency.

---

## 6. Deployment Architecture

```
Internet
    │
    ├── https://<project>.vercel.app     ← Frontend (Vercel)
    │       Next.js static + SSR
    │       NEXT_PUBLIC_WS_URL → wss://backend
    │
    └── https://<project>.up.railway.app ← Backend (Railway)
            FastAPI + uvicorn
            ANTHROPIC_API_KEY (env var)
            /health ← pinged every 5min by UptimeRobot
```

### Environment Variables

| Variable | Service | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Backend | Claude API key — never exposed to frontend |
| `NEXT_PUBLIC_WS_URL` | Frontend | `wss://` URL of Railway backend WebSocket endpoint |

### Keep-Alive Strategy

Railway free tier suspends inactive services after ~10 minutes. UptimeRobot (free plan) pings `GET /health` every 5 minutes. FastAPI's `/health` handler returns instantly (`{"status":"ok","clients":<n>}`) — no DB query, no side effects.

---

## 7. Performance Characteristics

| Concern | Solution | Expected Result |
|---|---|---|
| 10Hz WebSocket → React re-renders | RAF drain queue + robotPosRef bypass | Zero React re-renders from position updates |
| ECharts redraw at 10Hz | Throttle to 4Hz (250ms gate) | 4 ECharts redraws/sec, invisible to human eye |
| Three.js GPU memory over 24h | Geometry/material cache + dispose on unmount | Memory stable; no accumulation |
| Claude API latency (3–8s/call) | Non-blocking asyncio.create_task + streaming agent status | Sensor stream uninterrupted; UI shows live progress |
| WebSocket burst (reconnect) | Queue absorbs burst; drained on next frame | No message loss, no jank |

---

## 8. Key Design Decisions

### Why EventBus over direct function calls?
The simulation loop needs to notify both the WebSocket gateway (fast path) and the agent orchestrator (slow path, may be blocked on Claude API) simultaneously. The EventBus gives each subscriber its own queue, so the slow subscriber never blocks the fast one.

### Why refs for robot positions instead of Zustand?
Zustand triggers React reconciliation on every state write. At 10Hz with 3 robots, that's 30 potential re-renders/second. The Three.js `requestAnimationFrame` loop runs independently of React — reading from a ref is zero-cost.

### Why separate FastAPI backend instead of Next.js API routes?
Next.js Vercel deployment has a 10-second execution limit on serverless functions, which is exactly our Claude API timeout budget. A persistent FastAPI process on Railway has no such limit, can maintain WebSocket connections indefinitely, and runs the asyncio simulation loop continuously.

### Why `claude-sonnet-4-6` over Opus?
Sonnet provides sufficient reasoning quality for structured JSON extraction tasks (fault classification, coordinate routing, RICE scoring) at significantly lower latency and cost. Opus would add latency without meaningful improvement in output quality for these constrained, well-prompted tasks.
