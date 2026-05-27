# SDF Digital Twin Multi-Agent Simulator — Design Spec

**Date:** 2026-05-27  
**Status:** Approved  
**Goal:** Portfolio + learning project demonstrating frontend optimization and AI orchestration. Balanced emphasis on visual impact and engineering authenticity.

---

## 1. Overview

A Software Defined Factory (SDF) Digital Twin simulator with three integrated layers:

1. **3D Factory Floor** — real-time Three.js visualization of machines and AMR robots
2. **Real-Time Data Pipeline** — WebSocket-streamed sensor data rendered in ECharts
3. **Multi-Agent AI Chain** — Claude API-based agents that detect anomalies, dispatch robots, and produce RICE-based action plans

MVP scope: 5 machines, 3 robots, fully functional agent chain, deployed publicly.

---

## 2. Repository Structure

```
sdf-digital-twin/
├── frontend/          # Next.js 14 + TypeScript + Tailwind CSS
│   ├── app/
│   ├── components/
│   ├── hooks/
│   ├── store/
│   └── lib/
├── backend/           # FastAPI + Python
│   ├── simulator/
│   ├── agents/
│   ├── gateway/
│   └── main.py
└── docs/
    └── superpowers/specs/
```

Monorepo, two independently deployable services. Frontend → Vercel. Backend → Railway.

---

## 3. System Architecture

### 3.1 Backend (FastAPI)

Three responsibilities in one Python process:

```
FastAPI Process
│
├── SensorSimulator (asyncio loop, 10Hz)
│     └── publishes to internal EventBus
│
├── EventBus (asyncio.Queue, in-process)
│     ├── → WebSocketGateway (broadcast to all connected clients)
│     └── → AgentOrchestrator (watch for ANOMALY_DETECTED events)
│
└── AgentOrchestrator
      ├── Agent A: anomaly detection  → Claude API
      ├── Agent B: robot routing      → Claude API
      └── Agent C: RICE decision      → Claude API
            └── all results → WebSocket → frontend
```

**`SensorSimulator`**
- Runs as an `asyncio` background task at 10Hz
- Generates vibration (Hz), temperature (°C), motor current (A) for 5 machines
- Generates (x, y) position, heading, and status for 3 robots
- Injects fault spikes into a random machine every 60–120 seconds (deterministic via seeded random)
- Emits one batched `sensor_update` message per tick (all machines + robots combined)

**`AgentOrchestrator`**
- Subscribes to `ANOMALY_DETECTED` events from the EventBus
- Runs `agent_a → agent_b → agent_c` sequentially as an `asyncio.create_task()` (non-blocking)
- Emits `agent_event` WebSocket messages at start and completion of each agent
- Each agent has a 10-second timeout with a structured fallback response on failure

**`WebSocketGateway`**
- Manages connected client set
- Broadcasts all EventBus messages to all clients
- Handles client connect/disconnect cleanly

### 3.2 Frontend (Next.js 14)

Three rendering layers, isolated by update frequency:

| Layer | Technology | Update Rate | State Path |
|---|---|---|---|
| 3D Factory Floor | Three.js (WebGL) | 60fps | `useRef` (bypass React) |
| Sensor Charts | ECharts (Canvas) | 4Hz (throttled) | Zustand subscription |
| Agent Panel | React DOM | Event-driven | Zustand (sparse) |

**Critical isolation rule:** Robot positions update at 10Hz. These write directly to a `robotPositionRef` (a plain object ref), bypassing Zustand entirely. The Three.js animation loop reads from this ref. Zustand only receives robot *status* changes (`idle → dispatched → arrived`) to avoid React re-render cascades.

### 3.3 End-to-End Data Flow

**Normal operation:**
```
SensorSimulator → EventBus → WebSocketGateway
  → WS message: sensor_update
    → useWebSocket (frontend) → queue → frame drain
      → Zustand: machines[], robots[] status
        → Three.js: machine status colors, robot positions (via ref)
        → ECharts: time-series charts (throttled 4Hz)
```

**Anomaly → agent chain:**
```
SensorSimulator injects fault spike
  → EventBus: ANOMALY_DETECTED
    → AgentOrchestrator.run_chain() [asyncio.create_task]
      → WS: agent_event {agentId: "A", status: "running"}
      → Agent A → Claude API → anomaly report
      → WS: agent_event {agentId: "A", status: "complete", summary: "..."}
      → Agent B → Claude API → robot dispatch
      → WS: agent_event {agentId: "B", status: "complete"}
      → WS: robot_dispatch {robotId, path: [[x,y]...], eta}
        → Zustand: activeAlert, robot status → dispatched
        → Three.js: animates robot along waypoint path
      → Agent C → Claude API → RICE report
      → WS: agent_event {agentId: "C", status: "complete", summary: "..."}
        → Agent Panel: renders full RICE report
```

---

## 4. Data Contracts

All WebSocket messages share this envelope:

```typescript
type WSMessage =
  | { type: "sensor_update";  payload: SensorSnapshot }
  | { type: "robot_update";   payload: RobotSnapshot[] }
  | { type: "agent_event";    payload: AgentEvent }
  | { type: "robot_dispatch"; payload: DispatchCommand }
  | { type: "alert";          payload: Alert }
```

### SensorSnapshot (sent every 100ms)
```typescript
{
  ts: number
  machines: Record<MachineId, {
    vibration: number       // Hz, normal: 20–80
    temperature: number     // °C, normal: 40–90
    current: number         // A, normal: 5–30
    status: "normal" | "degraded" | "fault"
  }>
  robots: Record<RobotId, {
    x: number               // 0–20 grid units
    y: number               // 0–20 grid units
    heading: number         // degrees
    status: "idle" | "moving" | "dispatched" | "arrived"
  }>
}
```

### DispatchCommand
```typescript
{
  robotId: string
  targetMachineId: string
  path: [number, number][]  // waypoints for Three.js animation
  estimatedArrival: number  // seconds
}
```

### AgentEvent
```typescript
{
  agentId: "A" | "B" | "C"
  status: "running" | "complete" | "error"
  summary: string           // Claude's output (parsed), shown in Agent Panel
  ts: number
}
```

---

## 5. Frontend Component Structure

```
app/
├── page.tsx                    # layout shell, mounts all panels
├── components/
│   ├── FactoryCanvas.tsx       # Three.js scene, isolated in useEffect
│   ├── SensorChart.tsx         # ECharts wrapper, one instance per machine
│   ├── AgentPanel.tsx          # live agent chain status + RICE report
│   └── AlertBanner.tsx         # appears on activeAlert, dismissed on resolve
├── hooks/
│   ├── useWebSocket.ts         # single WS connection, message queue + frame drain
│   └── useThreeScene.ts        # Three.js lifecycle: init, animate, dispose
├── store/
│   └── factoryStore.ts         # Zustand store
└── lib/
    └── threeHelpers.ts         # geometry cache, material cache, robot mesh builder
```

### Zustand Store Shape
```typescript
{
  machines: Record<MachineId, MachineState>
  robots: Record<RobotId, RobotState>        // status only, not position
  agentEvents: AgentEvent[]                  // append-only log
  activeAlert: Alert | null
  dispatchCommand: DispatchCommand | null
}
```

---

## 6. Agent Prompt Design

All agents return structured JSON. Responses are parsed with a Pydantic model; parse failures trigger the fallback path.

**Agent A — Diagnostic**
Input: 30-second sensor window for the faulted machine (ts, vibration, temperature, current arrays).  
Output: `{ severity: "low"|"medium"|"high", classification: string, affected_components: string[], confidence: number }`  
Prompt strategy: provide sensor history as a compact JSON array, ask for classification + reasoning in JSON.

**Agent B — Routing**
Input: Agent A report + factory floor state (machine position, all robot positions + statuses).  
Output: `{ robotId: string, path: [[x,y],...], eta_seconds: number, reasoning: string }`  
Prompt strategy: describe the grid as a coordinate system, list obstacles (other machines), ask for greedy nearest-available selection with waypoint path.

**Agent C — Decision**
Input: Agent A report + Agent B dispatch result.  
Output: `{ recommendation: string, rice_scores: { immediate: RICEScore, scheduled: RICEScore, bypass: RICEScore }, rationale: string }`  
where `RICEScore = { reach, impact, confidence, effort, score }`.  
Prompt strategy: provide RICE formula definition in the prompt, give fault severity + eta as inputs, ask for three-option comparison.

---

## 7. Three.js Memory Management

**Geometry and material cache** — all geometries and materials are created once at scene init and stored in a module-level `Map`. No `new THREE.*` calls inside the animation loop or on robot position updates.

**Dispose on unmount:**
```typescript
return () => {
  scene.traverse(obj => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose()
      Array.isArray(obj.material)
        ? obj.material.forEach(m => m.dispose())
        : obj.material.dispose()
    }
  })
  renderer.dispose()
  renderer.forceContextLoss()
}
```

**Robot animation** — position interpolation runs inside `requestAnimationFrame` using delta-time. Target positions come from `robotPositionRef.current`, updated by the WebSocket handler without touching React state.

---

## 8. Performance Mitigations

### WebSocket Backpressure
Frontend uses a message queue + RAF drain pattern:
```typescript
const queue = useRef<WSMessage[]>([])
ws.onmessage = (e) => queue.current.push(JSON.parse(e.data))  // never blocks

const drain = () => {
  const batch = queue.current.splice(0)
  if (batch.length) applyBatchToStore(batch)
  rafId = requestAnimationFrame(drain)
}
```

### ECharts Throttle
Zustand subscription is rate-limited to 4Hz (250ms minimum interval) per chart instance. ECharts `setOption` is called in `notMerge: false` (append) mode — only new data points are processed, not full dataset redraws.

### Claude API Latency
- Each agent emits `status: "running"` immediately so the UI shows live progress
- `run_chain()` is a non-blocking `asyncio.create_task()` — sensor streaming is unaffected
- 10-second timeout per agent call; structured fallback on timeout

---

## 9. Deployment

| Service | Platform | Notes |
|---|---|---|
| Frontend | Vercel | Auto-deploy from `frontend/` subdirectory |
| Backend | Railway | Single Python service, `uvicorn main:app` |
| Keep-alive | UptimeRobot (free) | Pings `/health` every 5 min to prevent cold starts |

Environment variables:
- `ANTHROPIC_API_KEY` — backend only, never exposed to frontend
- `NEXT_PUBLIC_WS_URL` — WebSocket endpoint URL for frontend

---

## 10. MVP Build Order

1. Backend skeleton: FastAPI + WebSocket gateway + hardcoded sensor simulator
2. Frontend: Three.js scene with static machines + 3 robots (no data yet)
3. Connect WebSocket: robot positions animate from simulator data
4. Add ECharts sensor charts wired to WebSocket stream
5. Implement Agent A (anomaly detection) + AlertBanner UI
6. Implement Agent B (routing) + robot dispatch animation in Three.js
7. Implement Agent C (RICE report) + Agent Panel UI
8. Polish: memory leak audit, throttle tuning, mobile layout
9. Deploy: Railway backend + Vercel frontend + UptimeRobot keep-alive

---

## 11. Out of Scope (MVP)

- A* pathfinding (robots use waypoint interpolation; upgrade post-MVP)
- Collision avoidance between robots
- Authentication or multi-user sessions
- Persistent storage of agent reports
- Mobile-optimized Three.js scene
