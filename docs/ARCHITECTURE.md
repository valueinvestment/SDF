# System Architecture
# SDF Digital Twin Multi-Agent Simulator

**Date:** 2026-06-08  
**Version:** 1.3

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
                            │ WebSocket (wss://) — bidirectional
                            │ backend→frontend: ~10Hz sensor stream, agent events
                            │ frontend→backend: sync_entities on connect / entity change
┌───────────────────────────┴─────────────────────────────┐
│                     BACKEND (Railway)                   │
│  FastAPI + Python + asyncio                             │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │  SensorSimulator (asyncio task, 10Hz)            │   │
│  │  - dynamic entity list (synced from frontend)    │   │
│  │  - default: 5 machines + 3 robots                │   │
│  │  - fault injection picks from live machine list  │   │
│  └─────────────────────┬────────────────────────────┘   │
│                        │                                │
│                   EventBus (asyncio.Queue)              │
│                  /              \                       │
│  ┌──────────────┘                └────────────────┐     │
│  │  WebSocketGateway              AgentOrchestrator│     │
│  │  + entity registry (id→category)  (on ANOMALY)  │     │
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
- **Fault injection**: one machine at a time, every 60–120s, lasting 30s, picks from live machine list
- **Robot positions**: static per entity (updated only when Agent B dispatches)
- **Dynamic entity list**: `sync_entities(machines, robots)` reconciles the simulator's internal state with the frontend's placed entity list — new entities start generating data immediately on the next tick, removed entities are silently dropped

```python
# Called by WebSocketGateway when frontend sends sync_entities
simulator.sync_entities(
    machines={"press-1234": (5.0, 8.0), "M1": (3.0, 3.0), ...},
    robots={"robot-5678": (10.0, 10.0), "R1": (10.0, 10.0), ...},
)
```

### 2.4 DetailSimulator

Generates 2Hz machine wear/thermal and robot path detail, streamed only to clients subscribed to a specific entity (`subscribe_detail` / `unsubscribe_detail`). Key behaviors:

- **Machine detail**: per-component wear bars, thermal grid, operation rate
- **Robot path**: current position + patrol waypoints derived from entity position
- **Dynamic machines**: `sync_machines(machine_ids)` adds new entries to the wear model, removes departed ones
- **Dynamic robots**: `sync_robots(robots)` updates the internal position map used by `get_robot_path()`

### 2.5 WebSocketGateway

Manages WebSocket connections and routes inbound client messages.

**Inbound message handlers:**

| Message type | Action |
|---|---|
| `subscribe_detail` | Start streaming detail data for `entityId` to this client |
| `unsubscribe_detail` | Stop streaming detail data to this client |
| `sync_entities` | Reconcile simulator + detail simulator state; update entity registry |

**Entity registry** (`_entity_registry: dict[str, str]`) — maintained on each `sync_entities` call. Maps `entity_id → "machine" | "robot"`. Used by `detail_loop` via `get_entity_category(entity_id)` instead of fragile ID-prefix matching (`startswith("M")`), so dynamic IDs like `press-1730000000000` route correctly.

### 2.6 AgentOrchestrator

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

### 2.7 File Structure

```
backend/
├── main.py                    # FastAPI app, lifespan wiring, simulation/detail/broadcast loops
├── pyproject.toml             # uv-managed dependencies
├── .env                       # ANTHROPIC_API_KEY (not committed)
├── gateway/
│   ├── event_bus.py           # asyncio.Queue pub/sub
│   └── ws_gateway.py          # WebSocket manager + entity registry + sync_entities handler
├── simulator/
│   ├── models.py              # Pydantic: MachineState, RobotState, SensorSnapshot
│   ├── sensor_simulator.py    # 10Hz tick, dynamic entity list, fault injection
│   └── detail_simulator.py    # 2Hz machine wear/thermal + robot path, dynamic sync
├── agents/
│   ├── orchestrator.py        # Chain coordinator (guards against removed machines)
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

### 3.3 Entity Placement System

Users can add machines and robots to the 3D canvas via a modal. The system enforces a limit of **5 entities per type** (press / cnc / conveyor / robot).

**Flow:**
1. User clicks "+ 추가" in the Palette sidebar → `AddEntityModal` opens
2. Modal shows 4 type cards (press / cnc / conveyor / robot) each with a `count / 5` badge
3. Clicking a card → modal closes → `enterPlacementMode(type, id, label)` in the store
4. User clicks the 3D canvas floor → `placeEntity()` adds the entity to `placedEntities`
5. `useWebSocket` drain loop detects the change and sends `sync_entities` to the backend

**ID generation:** `${type}-${Date.now()}` (e.g., `press-1749375234123`). Default entities retain their legacy IDs (`M1`–`M5`, `R1`–`R3`).

**Limit enforcement:** `placedEntities.filter(e => e.type === type).length >= 5` — computed at render time, no separate counter state.

**Detail panel routing:** `page.tsx` derives `isMachineSelected` / `isRobotSelected` from `placedEntities.find(e => e.id === selectedId)?.type` — never from ID prefix, so dynamic IDs route correctly.

### 3.4 Zustand Store

```typescript
interface FactoryStore {
  // Sensor state (from backend)
  machines: Record<string, MachineState>         // includes .history ring buffer
  robots: Record<string, RobotState>             // status only, not position
  agentEvents: AgentEvent[]
  activeAlert: Alert | null
  dispatchCommand: DispatchCommand | null

  // Entity placement (source of truth for canvas layout)
  placedEntities: PlacedEntity[]                 // default: M1–M5 + R1–R3
  placementMode: { type, poolId, label } | null  // non-null while awaiting canvas click
  selectedEntityId: string | null

  // Detail data (streamed at 2Hz when entity selected)
  machineDetails: Record<string, MachineDetail>
  robotPaths: Record<string, RobotPathDetail>
  componentFaults: Record<string, ComponentFaultMap>
}
```

`MachineState.history` is a `[ts, vibration, temperature, current][]` ring buffer capped at 300 points (30 seconds at 10Hz).

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
│   └── page.tsx               # Layout shell; derives panel routing from entity type (not ID prefix)
├── components/
│   ├── FactoryCanvas.tsx      # Renders <canvas>, receives canvasRef as prop
│   ├── Palette.tsx            # Sidebar: dynamic entity list from placedEntities + "+ 추가" button
│   ├── AddEntityModal.tsx     # Type-picker modal (2×2 grid, 5-per-type limit)
│   ├── MachineDetailPanel.tsx # Wear bars + thermal heatmap (ECharts)
│   ├── RobotDetailPanel.tsx   # Robot path + patrol waypoints
│   ├── SensorChart.tsx        # ECharts line chart, one per placed machine
│   ├── AgentPanel.tsx         # Agent chain status + RICE report display
│   ├── AlertBanner.tsx        # Alert overlay
│   ├── AlertHistory.tsx       # Past alert log
│   └── ToastContainer.tsx     # Toast notification stack
├── hooks/
│   ├── useWebSocket.ts        # WS connection, message queue, RAF drain
│   │                          # sends sync_entities on open + on placedEntities change
│   └── useThreeScene.ts       # Three.js init, animate loop, dispose
├── store/
│   └── factoryStore.ts        # Zustand store: sensor state + placement system + detail data
├── lib/
│   ├── types.ts               # Shared TypeScript interfaces (mirrors backend models)
│   └── threeHelpers.ts        # Geometry cache, material cache, disposeScene
└── __tests__/
    └── factoryStore.test.ts
```

---

## 4. Data Contracts

The WebSocket connection is bidirectional. Messages are JSON with a `type` + `payload` envelope.

**Backend → Frontend:**
```typescript
type WSMessage =
  | { type: "sensor_update";    payload: SensorSnapshot }
  | { type: "robot_dispatch";   payload: DispatchCommand }
  | { type: "agent_event";      payload: AgentEvent }
  | { type: "alert";            payload: Alert }
  | { type: "machine_detail";   payload: MachineDetail }
  | { type: "robot_path";       payload: RobotPathDetail }
  | { type: "component_fault";  payload: ComponentFaultMap }
```

**Frontend → Backend:**
```typescript
// Sent on WS connect and whenever placedEntities changes
{ type: "sync_entities"; payload: {
    entities: { id: string; category: "machine" | "robot"; x: number; z: number }[]
}}

// Sent when user selects an entity in the Palette or 3D canvas
{ type: "subscribe_detail";   payload: { entityId: string } }
{ type: "unsubscribe_detail"; payload: { entityId: string } }
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

### Why sync_entities instead of individual add/remove messages?
A full-state sync on every change is simpler to reason about than incremental add/remove: the backend always arrives at the correct state regardless of message ordering or missed events. The payload is small (≤20 entities), so the overhead is negligible. The frontend sends it on WS open (handles reconnect) and whenever `placedEntities` changes (detected in the RAF drain loop via JSON key comparison).

### Why entity registry in WebSocketGateway instead of ID-prefix convention?
Dynamic entity IDs (`press-1749375234123`, `robot-1749375234456`) have no M/R prefix. Hardcoding prefix checks creates a permanent coupling between ID format and routing logic. The registry is populated by `sync_entities` and provides an explicit `category` lookup, making the format of entity IDs irrelevant to backend routing.

### Why derive isMachineSelected from placedEntities type instead of ID prefix?
Same reason as entity registry — the frontend must not encode business logic in ID string patterns. `placedEntities.find(e => e.id === selectedId)?.type` is always accurate regardless of how the ID was generated.

---

## 9. No-Code Builder Extensions

These extensions let users customize and extend the platform without touching the stable data pipeline or the Three.js render loop.

### 9.1 Custom 3D Model Injection (GLB/GLTF)

A new `EntityType` value `"custom"` carries an optional `modelUrl` on `PlacedEntity`. Users either drag-drop a `.glb`/`.gltf` file (converted to an `ObjectURL`) or paste an external URL in `AddEntityModal`.

```
AddEntityModal (drop / URL) → enterPlacementMode(type, id, label, modelUrl)
        → placeEntity persists { type: "custom", modelUrl }
        → useThreeScene animate loop: loadGLTFModel(modelUrl, id)
```

- **Loader:** `loadGLTFModel()` in `threeHelpers.ts` wraps `GLTFLoader`, auto-scales to a 2-unit bounding box, floor-aligns, and **caches parsed scenes by URL** (clones on reuse).
- **Async race guard:** `gltfLoadingRef` (a `Set<entityId>`) prevents the animate loop from issuing duplicate loads for the same entity while a load is in flight.
- **Gizmo binding:** Custom groups carry `userData.entityId`, so the existing `TransformControls` + grid-snap (`snapToGrid`) path attaches to them unchanged — scale/rotation/position editing works identically to built-in machines.
- **Memory:** Custom GLTF geometry/materials are **unique per load**, so on entity removal the loop calls `disposeGLTFModel()`. Built-in machines use cached shared geometry and are deliberately **not** disposed on removal.

Storage is browser-memory only (ObjectURL / external URL) — no backend file store. Custom entities are not machines, so they receive no MES WorkOrder.

### 9.2 Draggable Grid Layout Manager (react-grid-layout v2)

`LayoutPanel` moved from CSS-Grid span strings (`col: "1 / 3"`) to **integer coordinates** (`x, y, w, h`). `LayoutConfig.version` is bumped to `2`.

- **Library:** `react-grid-layout@2.x` — a full rewrite. The deprecated `WidthProvider` HOC is **not** used; width comes from the `useContainerWidth()` hook (ResizeObserver-based), consistent with the project's existing ResizeObserver patterns. Behavior is configured via `dragConfig`/`resizeConfig` objects and `compactor={verticalCompactor}` (not v1 flat props).
- **Persistence:** Drag/resize commits flow through `setLayoutConfig` → serialized into `dashboardConfig` → URL/localStorage (§9.3). Editing is gated by `editingLayout`; panels are `static` when not editing.
- **Migration:** `importConfig` detects `layoutConfig.version !== 2` and resets to the v2 default layout, so legacy share-links degrade gracefully instead of crashing.

### 9.3 Defensive URL Serialization

Custom models + free layout can inflate the config JSON. `lib/configSerialization.ts` (a pure, unit-tested module extracted from `useConfigSync`) guards the URL sync:

```
exportConfig() → lz.compressToEncodedURIComponent → decideSyncStrategy(compressed)
   ├── length ≤ 4000  → write ?config= to URL (history.replaceState)
   └── length > 4000  → saveToLocalStorage("sdf-config-fallback")
                         + delete ?config= + warning Toast
```

`URL_SAFE_LENGTH = 4000` is a conservative floor under common browser/server URI limits. On load, `applyURLConfig` restores from the URL param first, then falls back to localStorage. The strategy decision is a pure function (`decideSyncStrategy`), so it is fully testable without a DOM.
