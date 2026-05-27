# SDF Digital Twin Multi-Agent Simulator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full-stack SDF Digital Twin simulator with a 3D factory floor, real-time WebSocket sensor streams, and a Claude API-powered multi-agent diagnostic chain.

**Architecture:** FastAPI backend (sensor simulator + WebSocket gateway + agent orchestrator) communicates with a Next.js 14 frontend over a single WebSocket connection. Three.js renders the 3D factory floor reading robot positions from a ref (bypassing React), ECharts renders throttled sensor charts via Zustand, and an Agent Panel shows the live Claude API agent chain.

**Tech Stack:** Python 3.11+, FastAPI, anthropic SDK, asyncio / Next.js 14, TypeScript, Three.js, ECharts, Zustand, Tailwind CSS

---

## File Map

### Backend (`backend/`)
| File | Responsibility |
|---|---|
| `main.py` | FastAPI app, startup wiring, WebSocket route |
| `requirements.txt` | Python dependencies |
| `gateway/event_bus.py` | In-process asyncio.Queue EventBus |
| `gateway/ws_gateway.py` | WebSocket connection manager, broadcast |
| `simulator/models.py` | Pydantic models: SensorSnapshot, RobotState, WSMessage |
| `simulator/sensor_simulator.py` | 10Hz sensor + robot data generation, fault injection |
| `agents/orchestrator.py` | AgentOrchestrator: listens for ANOMALY_DETECTED, runs chain |
| `agents/agent_a.py` | Diagnostic agent: calls Claude API, returns AnomalyReport |
| `agents/agent_b.py` | Routing agent: calls Claude API, returns DispatchCommand |
| `agents/agent_c.py` | Decision agent: calls Claude API, returns RICEReport |
| `tests/test_models.py` | Unit tests for Pydantic model validation |
| `tests/test_simulator.py` | Unit tests for sensor value generation and fault injection |
| `tests/test_agents.py` | Unit tests for Claude response parsing |

### Frontend (`frontend/`)
| File | Responsibility |
|---|---|
| `app/page.tsx` | Layout shell, mounts all panels |
| `app/layout.tsx` | Root layout with Tailwind |
| `store/factoryStore.ts` | Zustand store: machines, robots status, agentEvents, activeAlert |
| `hooks/useWebSocket.ts` | Single WS connection, message queue, RAF drain |
| `hooks/useThreeScene.ts` | Three.js lifecycle: init, animate loop, dispose |
| `lib/threeHelpers.ts` | Geometry cache, material cache, mesh builders |
| `lib/types.ts` | Shared TypeScript types matching backend WSMessage contracts |
| `components/FactoryCanvas.tsx` | Mounts canvas, calls useThreeScene |
| `components/SensorChart.tsx` | ECharts wrapper, throttled Zustand subscription |
| `components/AgentPanel.tsx` | Live agent chain status + RICE report |
| `components/AlertBanner.tsx` | Appears on activeAlert |
| `__tests__/factoryStore.test.ts` | Unit tests for Zustand store reducers |
| `__tests__/types.test.ts` | Unit tests for type guard functions |

---

## Phase 1: Backend Foundation

### Task 1: Monorepo Scaffolding

**Files:**
- Create: `backend/requirements.txt`
- Create: `backend/main.py`
- Create: `backend/.env.example`
- Create: `backend/gateway/__init__.py`
- Create: `backend/simulator/__init__.py`
- Create: `backend/agents/__init__.py`
- Create: `backend/tests/__init__.py`

- [ ] **Step 1: Create directory structure**

```bash
cd sdf-digital-twin
mkdir -p backend/gateway backend/simulator backend/agents backend/tests
touch backend/gateway/__init__.py backend/simulator/__init__.py backend/agents/__init__.py backend/tests/__init__.py
```

- [ ] **Step 2: Write `backend/requirements.txt`**

```
fastapi==0.111.0
uvicorn[standard]==0.29.0
websockets==12.0
anthropic==0.28.0
python-dotenv==1.0.1
pydantic==2.7.1
pytest==8.2.0
pytest-asyncio==0.23.6
httpx==0.27.0
```

- [ ] **Step 3: Write `backend/.env.example`**

```
ANTHROPIC_API_KEY=your_key_here
```

- [ ] **Step 4: Write `backend/main.py` (skeleton)**

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="SDF Digital Twin Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://*.vercel.app"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {"status": "ok"}
```

- [ ] **Step 5: Install dependencies and verify startup**

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Expected: `Application startup complete.` Visit `http://localhost:8000/health` → `{"status":"ok"}`

- [ ] **Step 6: Commit**

```bash
git add backend/
git commit -m "feat: backend project scaffold with FastAPI health endpoint"
```

---

### Task 2: Pydantic Models

**Files:**
- Create: `backend/simulator/models.py`
- Create: `backend/tests/test_models.py`

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/test_models.py
import pytest
from simulator.models import MachineState, RobotState, SensorSnapshot, WSMessage

def test_machine_state_normal():
    m = MachineState(vibration=50.0, temperature=70.0, current=15.0, status="normal")
    assert m.status == "normal"

def test_machine_state_rejects_invalid_status():
    with pytest.raises(Exception):
        MachineState(vibration=50.0, temperature=70.0, current=15.0, status="broken")

def test_sensor_snapshot_serializes():
    snap = SensorSnapshot(
        ts=1000,
        machines={"M1": MachineState(vibration=50.0, temperature=70.0, current=15.0, status="normal")},
        robots={"R1": RobotState(x=5.0, y=5.0, heading=0.0, status="idle")},
    )
    data = snap.model_dump()
    assert data["machines"]["M1"]["status"] == "normal"

def test_ws_message_sensor_update():
    snap = SensorSnapshot(ts=1000, machines={}, robots={})
    msg = WSMessage(type="sensor_update", payload=snap.model_dump())
    assert msg.type == "sensor_update"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend
pytest tests/test_models.py -v
```

Expected: `ModuleNotFoundError: No module named 'simulator.models'`

- [ ] **Step 3: Write `backend/simulator/models.py`**

```python
from pydantic import BaseModel
from typing import Literal, Dict, Any

MachineStatus = Literal["normal", "degraded", "fault"]
RobotStatus = Literal["idle", "moving", "dispatched", "arrived"]

class MachineState(BaseModel):
    vibration: float      # Hz
    temperature: float    # °C
    current: float        # A
    status: MachineStatus

class RobotState(BaseModel):
    x: float
    y: float
    heading: float        # degrees
    status: RobotStatus

class SensorSnapshot(BaseModel):
    ts: int               # unix ms
    machines: Dict[str, MachineState]
    robots: Dict[str, RobotState]

class DispatchCommand(BaseModel):
    robotId: str
    targetMachineId: str
    path: list[list[float]]   # [[x,y], ...]
    estimatedArrival: float   # seconds

class AgentEvent(BaseModel):
    agentId: Literal["A", "B", "C"]
    status: Literal["running", "complete", "error"]
    summary: str
    ts: int

class WSMessage(BaseModel):
    type: str
    payload: Any
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_models.py -v
```

Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add backend/simulator/models.py backend/tests/test_models.py
git commit -m "feat: backend Pydantic data models with tests"
```

---

### Task 3: EventBus + WebSocket Gateway

**Files:**
- Create: `backend/gateway/event_bus.py`
- Create: `backend/gateway/ws_gateway.py`

- [ ] **Step 1: Write `backend/gateway/event_bus.py`**

```python
import asyncio
from typing import Any

class EventBus:
    def __init__(self):
        self._queues: list[asyncio.Queue] = []

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self._queues.append(q)
        return q

    async def publish(self, event: Any) -> None:
        for q in self._queues:
            await q.put(event)
```

- [ ] **Step 2: Write `backend/gateway/ws_gateway.py`**

```python
import json
from fastapi import WebSocket

class WebSocketGateway:
    def __init__(self):
        self._clients: set[WebSocket] = set()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._clients.add(ws)

    def disconnect(self, ws: WebSocket) -> None:
        self._clients.discard(ws)

    async def broadcast(self, message: dict) -> None:
        data = json.dumps(message)
        dead: set[WebSocket] = set()
        for client in self._clients:
            try:
                await client.send_text(data)
            except Exception:
                dead.add(client)
        self._clients -= dead

    @property
    def client_count(self) -> int:
        return len(self._clients)
```

- [ ] **Step 3: Add WebSocket route to `backend/main.py`**

```python
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from gateway.ws_gateway import WebSocketGateway

app = FastAPI(title="SDF Digital Twin Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://*.vercel.app"],
    allow_methods=["*"],
    allow_headers=["*"],
)

gateway = WebSocketGateway()

@app.get("/health")
async def health():
    return {"status": "ok", "clients": gateway.client_count}

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await gateway.connect(ws)
    try:
        while True:
            await ws.receive_text()   # keep connection alive
    except WebSocketDisconnect:
        gateway.disconnect(ws)
```

- [ ] **Step 4: Smoke test WebSocket manually**

```bash
uvicorn main:app --reload --port 8000
```

In a second terminal:
```bash
python -c "
import asyncio, websockets, json
async def test():
    async with websockets.connect('ws://localhost:8000/ws') as ws:
        print('connected')
        await asyncio.sleep(1)
asyncio.run(test())
"
```

Expected: prints `connected` without error.

- [ ] **Step 5: Commit**

```bash
git add backend/gateway/ backend/main.py
git commit -m "feat: EventBus and WebSocket gateway with connect/broadcast"
```

---

### Task 4: Sensor Simulator

**Files:**
- Create: `backend/simulator/sensor_simulator.py`
- Create: `backend/tests/test_simulator.py`

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/test_simulator.py
import pytest
from simulator.sensor_simulator import SensorSimulator

def test_initial_machine_statuses_are_normal():
    sim = SensorSimulator(seed=42)
    snapshot = sim.tick()
    for mid, machine in snapshot.machines.items():
        assert machine.status == "normal"

def test_all_machines_present():
    sim = SensorSimulator(seed=42)
    snapshot = sim.tick()
    assert set(snapshot.machines.keys()) == {"M1", "M2", "M3", "M4", "M5"}

def test_all_robots_present():
    sim = SensorSimulator(seed=42)
    snapshot = sim.tick()
    assert set(snapshot.robots.keys()) == {"R1", "R2", "R3"}

def test_sensor_values_in_normal_range():
    sim = SensorSimulator(seed=42)
    for _ in range(10):
        snapshot = sim.tick()
    for m in snapshot.machines.values():
        if m.status == "normal":
            assert 20 <= m.vibration <= 80
            assert 40 <= m.temperature <= 90
            assert 5 <= m.current <= 30

def test_fault_injection_changes_status():
    sim = SensorSimulator(seed=42)
    sim.inject_fault("M1")
    snapshot = sim.tick()
    assert snapshot.machines["M1"].status in ("degraded", "fault")
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_simulator.py -v
```

Expected: `ModuleNotFoundError: No module named 'simulator.sensor_simulator'`

- [ ] **Step 3: Write `backend/simulator/sensor_simulator.py`**

```python
import random
import time
import math
from simulator.models import MachineState, RobotState, SensorSnapshot

MACHINE_POSITIONS: dict[str, tuple[float, float]] = {
    "M1": (3.0, 3.0),
    "M2": (7.0, 3.0),
    "M3": (12.0, 3.0),
    "M4": (3.0, 12.0),
    "M5": (12.0, 12.0),
}

ROBOT_POSITIONS: dict[str, tuple[float, float]] = {
    "R1": (10.0, 10.0),
    "R2": (5.0, 5.0),
    "R3": (15.0, 5.0),
}

class SensorSimulator:
    def __init__(self, seed: int = 0):
        self._rng = random.Random(seed)
        self._faulted: set[str] = set()
        self._robot_positions = {k: list(v) for k, v in ROBOT_POSITIONS.items()}
        self._robot_headings = {k: 0.0 for k in ROBOT_POSITIONS}
        self._robot_statuses = {k: "idle" for k in ROBOT_POSITIONS}

    def inject_fault(self, machine_id: str) -> None:
        self._faulted.add(machine_id)

    def clear_fault(self, machine_id: str) -> None:
        self._faulted.discard(machine_id)

    def set_robot_status(self, robot_id: str, status: str) -> None:
        self._robot_statuses[robot_id] = status

    def move_robot(self, robot_id: str, x: float, y: float) -> None:
        self._robot_positions[robot_id] = [x, y]

    def tick(self) -> SensorSnapshot:
        machines = {}
        for mid in MACHINE_POSITIONS:
            if mid in self._faulted:
                status = "fault"
                vibration = self._rng.uniform(120, 200)
                temperature = self._rng.uniform(110, 150)
                current = self._rng.uniform(40, 60)
            else:
                status = "normal"
                vibration = self._rng.uniform(20, 80)
                temperature = self._rng.uniform(40, 90)
                current = self._rng.uniform(5, 30)
            machines[mid] = MachineState(
                vibration=round(vibration, 2),
                temperature=round(temperature, 2),
                current=round(current, 2),
                status=status,
            )

        robots = {}
        for rid in ROBOT_POSITIONS:
            pos = self._robot_positions[rid]
            robots[rid] = RobotState(
                x=round(pos[0], 2),
                y=round(pos[1], 2),
                heading=round(self._robot_headings[rid], 1),
                status=self._robot_statuses[rid],
            )

        return SensorSnapshot(
            ts=int(time.time() * 1000),
            machines=machines,
            robots=robots,
        )
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_simulator.py -v
```

Expected: 5 passed

- [ ] **Step 5: Wire simulator into `backend/main.py` startup**

```python
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import asyncio
import random
import time
from gateway.event_bus import EventBus
from gateway.ws_gateway import WebSocketGateway
from simulator.sensor_simulator import SensorSimulator

bus = EventBus()
gateway = WebSocketGateway()
simulator = SensorSimulator(seed=int(time.time()))

async def simulation_loop():
    """Runs at 10Hz. Every 60-120s injects a random fault."""
    next_fault_at = time.time() + random.uniform(60, 120)
    faulted_machine: str | None = None

    while True:
        now = time.time()

        if faulted_machine is None and now >= next_fault_at:
            faulted_machine = random.choice(["M1", "M2", "M3", "M4", "M5"])
            simulator.inject_fault(faulted_machine)
            await bus.publish({"type": "anomaly_detected", "machineId": faulted_machine})

        if faulted_machine and now >= next_fault_at + 30:
            simulator.clear_fault(faulted_machine)
            faulted_machine = None
            next_fault_at = now + random.uniform(60, 120)

        snapshot = simulator.tick()
        await bus.publish({"type": "sensor_update", "payload": snapshot.model_dump()})
        await asyncio.sleep(0.1)

async def broadcast_loop():
    """Reads from EventBus and broadcasts to all WS clients."""
    q = bus.subscribe()
    while True:
        event = await q.get()
        if event["type"] == "sensor_update":
            await gateway.broadcast(event)

@asynccontextmanager
async def lifespan(app: FastAPI):
    sim_task = asyncio.create_task(simulation_loop())
    broadcast_task = asyncio.create_task(broadcast_loop())
    yield
    sim_task.cancel()
    broadcast_task.cancel()

app = FastAPI(title="SDF Digital Twin Backend", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://*.vercel.app"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {"status": "ok", "clients": gateway.client_count}

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await gateway.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        gateway.disconnect(ws)
```

- [ ] **Step 6: Smoke test — verify WebSocket streams sensor data**

```bash
uvicorn main:app --reload --port 8000
```

Second terminal:
```bash
python -c "
import asyncio, websockets, json
async def test():
    async with websockets.connect('ws://localhost:8000/ws') as ws:
        for _ in range(5):
            msg = json.loads(await ws.recv())
            print(msg['type'], list(msg['payload']['machines'].keys()))
asyncio.run(test())
"
```

Expected: 5 lines each showing `sensor_update ['M1', 'M2', 'M3', 'M4', 'M5']`

- [ ] **Step 7: Commit**

```bash
git add backend/simulator/sensor_simulator.py backend/tests/test_simulator.py backend/main.py
git commit -m "feat: sensor simulator with 10Hz tick, fault injection, WebSocket broadcast"
```

---

## Phase 2: Frontend Foundation

### Task 5: Next.js Scaffold + Zustand Store

**Files:**
- Create: `frontend/` (Next.js project)
- Create: `frontend/lib/types.ts`
- Create: `frontend/store/factoryStore.ts`
- Create: `frontend/__tests__/factoryStore.test.ts`

- [ ] **Step 1: Scaffold Next.js project**

```bash
cd sdf-digital-twin
npx create-next-app@14 frontend --typescript --tailwind --eslint --app --no-src-dir --import-alias "@/*"
cd frontend
npm install zustand three @types/three echarts-for-react echarts
```

- [ ] **Step 2: Write `frontend/lib/types.ts`**

```typescript
export type MachineStatus = "normal" | "degraded" | "fault"
export type RobotStatus = "idle" | "moving" | "dispatched" | "arrived"
export type AgentId = "A" | "B" | "C"
export type AgentStatus = "running" | "complete" | "error"

export interface MachineState {
  vibration: number
  temperature: number
  current: number
  status: MachineStatus
  history: [number, number][]   // [ts, vibration] ring buffer, max 300 points
}

export interface RobotState {
  x: number
  y: number
  heading: number
  status: RobotStatus
}

export interface AgentEvent {
  agentId: AgentId
  status: AgentStatus
  summary: string
  ts: number
}

export interface DispatchCommand {
  robotId: string
  targetMachineId: string
  path: [number, number][]
  estimatedArrival: number
}

export interface Alert {
  machineId: string
  ts: number
}

export interface SensorSnapshot {
  ts: number
  machines: Record<string, Omit<MachineState, "history">>
  robots: Record<string, RobotState>
}

export type WSMessage =
  | { type: "sensor_update"; payload: SensorSnapshot }
  | { type: "robot_dispatch"; payload: DispatchCommand }
  | { type: "agent_event"; payload: AgentEvent }
  | { type: "alert"; payload: Alert }
```

- [ ] **Step 3: Write failing store tests**

```typescript
// frontend/__tests__/factoryStore.test.ts
import { describe, it, expect, beforeEach } from "vitest"
import { useFactoryStore } from "@/store/factoryStore"

beforeEach(() => {
  useFactoryStore.setState({
    machines: {},
    robots: {},
    agentEvents: [],
    activeAlert: null,
    dispatchCommand: null,
  })
})

describe("applySnapshot", () => {
  it("adds machines from snapshot", () => {
    useFactoryStore.getState().applySnapshot({
      ts: 1000,
      machines: {
        M1: { vibration: 50, temperature: 70, current: 15, status: "normal" },
      },
      robots: {},
    })
    const { machines } = useFactoryStore.getState()
    expect(machines["M1"].status).toBe("normal")
  })

  it("appends vibration to history ring buffer capped at 300", () => {
    const store = useFactoryStore.getState()
    for (let i = 0; i < 350; i++) {
      store.applySnapshot({
        ts: i * 100,
        machines: { M1: { vibration: i, temperature: 70, current: 15, status: "normal" } },
        robots: {},
      })
    }
    expect(useFactoryStore.getState().machines["M1"].history.length).toBe(300)
  })
})

describe("addAgentEvent", () => {
  it("appends to agentEvents", () => {
    useFactoryStore.getState().addAgentEvent({
      agentId: "A",
      status: "complete",
      summary: "test",
      ts: 1000,
    })
    expect(useFactoryStore.getState().agentEvents).toHaveLength(1)
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

```bash
cd frontend
npx vitest run __tests__/factoryStore.test.ts
```

Expected: `Cannot find module '@/store/factoryStore'`

- [ ] **Step 5: Write `frontend/store/factoryStore.ts`**

```typescript
import { create } from "zustand"
import type { MachineState, RobotState, AgentEvent, Alert, DispatchCommand, SensorSnapshot } from "@/lib/types"

const HISTORY_MAX = 300

interface FactoryStore {
  machines: Record<string, MachineState>
  robots: Record<string, RobotState>
  agentEvents: AgentEvent[]
  activeAlert: Alert | null
  dispatchCommand: DispatchCommand | null
  applySnapshot: (snapshot: SensorSnapshot) => void
  addAgentEvent: (event: AgentEvent) => void
  setActiveAlert: (alert: Alert | null) => void
  setDispatchCommand: (cmd: DispatchCommand | null) => void
}

export const useFactoryStore = create<FactoryStore>((set, get) => ({
  machines: {},
  robots: {},
  agentEvents: [],
  activeAlert: null,
  dispatchCommand: null,

  applySnapshot: (snapshot) => {
    set((state) => {
      const machines = { ...state.machines }
      for (const [id, data] of Object.entries(snapshot.machines)) {
        const prev = machines[id]
        const history: [number, number][] = prev ? [...prev.history] : []
        history.push([snapshot.ts, data.vibration])
        if (history.length > HISTORY_MAX) history.splice(0, history.length - HISTORY_MAX)
        machines[id] = { ...data, history }
      }
      return { machines, robots: { ...state.robots, ...snapshot.robots } }
    })
  },

  addAgentEvent: (event) => {
    set((state) => ({ agentEvents: [...state.agentEvents, event] }))
  },

  setActiveAlert: (alert) => set({ activeAlert: alert }),
  setDispatchCommand: (cmd) => set({ dispatchCommand: cmd }),
}))
```

- [ ] **Step 6: Add vitest config**

In `frontend/package.json`, add to scripts:
```json
"test": "vitest run"
```

Create `frontend/vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config"
import { resolve } from "path"

export default defineConfig({
  test: { environment: "node" },
  resolve: { alias: { "@": resolve(__dirname, ".") } },
})
```

Install vitest:
```bash
npm install -D vitest
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
npx vitest run __tests__/factoryStore.test.ts
```

Expected: 3 passed

- [ ] **Step 8: Commit**

```bash
git add frontend/
git commit -m "feat: Next.js scaffold, Zustand store with history ring buffer, types"
```

---

### Task 6: useWebSocket Hook (Queue + RAF Drain)

**Files:**
- Create: `frontend/hooks/useWebSocket.ts`

- [ ] **Step 1: Write `frontend/hooks/useWebSocket.ts`**

```typescript
"use client"
import { useEffect, useRef } from "react"
import { useFactoryStore } from "@/store/factoryStore"
import type { WSMessage } from "@/lib/types"

export function useWebSocket(url: string) {
  const queueRef = useRef<WSMessage[]>([])
  const rafRef = useRef<number>(0)
  const store = useFactoryStore.getState()

  useEffect(() => {
    const ws = new WebSocket(url)

    ws.onmessage = (e) => {
      try {
        queueRef.current.push(JSON.parse(e.data) as WSMessage)
      } catch {}
    }

    const drain = () => {
      const batch = queueRef.current.splice(0)
      for (const msg of batch) {
        if (msg.type === "sensor_update") {
          store.applySnapshot(msg.payload)
        } else if (msg.type === "agent_event") {
          store.addAgentEvent(msg.payload)
        } else if (msg.type === "alert") {
          store.setActiveAlert(msg.payload)
        } else if (msg.type === "robot_dispatch") {
          store.setDispatchCommand(msg.payload)
        }
      }
      rafRef.current = requestAnimationFrame(drain)
    }

    rafRef.current = requestAnimationFrame(drain)

    return () => {
      ws.close()
      cancelAnimationFrame(rafRef.current)
    }
  }, [url])
}
```

- [ ] **Step 2: Mount hook in `frontend/app/page.tsx`**

```typescript
"use client"
import { useWebSocket } from "@/hooks/useWebSocket"

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000/ws"

export default function Home() {
  useWebSocket(WS_URL)

  return (
    <main className="bg-gray-950 text-white min-h-screen p-4">
      <h1 className="text-xl font-bold mb-4">SDF Digital Twin</h1>
      <p className="text-gray-400">WebSocket connected — check console for data</p>
    </main>
  )
}
```

- [ ] **Step 3: Add `.env.local`**

```
NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws
```

- [ ] **Step 4: Run dev server and verify data flows**

```bash
# terminal 1 — backend
cd backend && uvicorn main:app --reload --port 8000

# terminal 2 — frontend
cd frontend && npm run dev
```

Open `http://localhost:3000`. Open browser DevTools → Network → WS tab.  
Expected: WebSocket connection to `ws://localhost:8000/ws`, steady stream of `sensor_update` messages at ~10Hz.

- [ ] **Step 5: Commit**

```bash
git add frontend/hooks/useWebSocket.ts frontend/app/page.tsx frontend/.env.local
git commit -m "feat: useWebSocket hook with RAF drain, wired to page"
```

---

### Task 7: Three.js Static Scene (Machines)

**Files:**
- Create: `frontend/lib/threeHelpers.ts`
- Create: `frontend/hooks/useThreeScene.ts`
- Create: `frontend/components/FactoryCanvas.tsx`

- [ ] **Step 1: Write `frontend/lib/threeHelpers.ts`**

```typescript
import * as THREE from "three"

// Geometry and material cache — created once, reused across all meshes
const geoCache = new Map<string, THREE.BufferGeometry>()
const matCache = new Map<string, THREE.Material>()

function getGeo(key: string, factory: () => THREE.BufferGeometry) {
  if (!geoCache.has(key)) geoCache.set(key, factory())
  return geoCache.get(key)!
}

function getMat(key: string, factory: () => THREE.Material) {
  if (!matCache.has(key)) matCache.set(key, factory())
  return matCache.get(key)!
}

export function buildMachineMesh(id: string): THREE.Mesh {
  const geo = getGeo("machine", () => new THREE.BoxGeometry(1.2, 1.2, 1.2))
  const mat = getMat("machine_normal", () =>
    new THREE.MeshStandardMaterial({ color: 0x3b82f6 })
  )
  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = id
  return mesh
}

export function buildRobotMesh(id: string): THREE.Mesh {
  const geo = getGeo("robot", () => new THREE.CylinderGeometry(0.3, 0.3, 0.4, 8))
  const mat = getMat("robot", () =>
    new THREE.MeshStandardMaterial({ color: 0x10b981 })
  )
  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = id
  return mesh
}

export const MACHINE_POSITIONS: Record<string, [number, number]> = {
  M1: [3, 3], M2: [7, 3], M3: [12, 3], M4: [3, 12], M5: [12, 12],
}

export const ROBOT_START_POSITIONS: Record<string, [number, number]> = {
  R1: [10, 10], R2: [5, 5], R3: [15, 5],
}

export function disposeScene(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose()
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose())
      else obj.material.dispose()
    }
  })
  renderer.dispose()
  renderer.forceContextLoss()
}
```

- [ ] **Step 2: Write `frontend/hooks/useThreeScene.ts`**

```typescript
"use client"
import { useEffect, useRef } from "react"
import * as THREE from "three"
import {
  buildMachineMesh, buildRobotMesh,
  MACHINE_POSITIONS, ROBOT_START_POSITIONS,
  disposeScene,
} from "@/lib/threeHelpers"

export interface RobotPositionRef {
  [robotId: string]: { x: number; y: number }
}

export function useThreeScene(canvasRef: React.RefObject<HTMLCanvasElement>) {
  const robotPosRef = useRef<RobotPositionRef>({})

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Scene setup
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x111827)

    const camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.1, 1000)
    camera.position.set(8, 18, 18)
    camera.lookAt(8, 0, 8)

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    renderer.setSize(canvas.clientWidth, canvas.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.6))
    const dir = new THREE.DirectionalLight(0xffffff, 0.8)
    dir.position.set(10, 20, 10)
    scene.add(dir)

    // Floor grid
    const grid = new THREE.GridHelper(20, 20, 0x374151, 0x1f2937)
    grid.position.set(10, 0, 10)
    scene.add(grid)

    // Machines
    for (const [id, [x, z]] of Object.entries(MACHINE_POSITIONS)) {
      const mesh = buildMachineMesh(id)
      mesh.position.set(x, 0.6, z)
      scene.add(mesh)
    }

    // Robots
    const robotMeshes: Record<string, THREE.Mesh> = {}
    for (const [id, [x, z]] of Object.entries(ROBOT_START_POSITIONS)) {
      const mesh = buildRobotMesh(id)
      mesh.position.set(x, 0.2, z)
      scene.add(mesh)
      robotMeshes[id] = mesh
      robotPosRef.current[id] = { x, y: z }
    }

    // Animation loop
    let rafId: number
    const animate = () => {
      rafId = requestAnimationFrame(animate)
      // Interpolate robot meshes toward target positions
      for (const [id, mesh] of Object.entries(robotMeshes)) {
        const target = robotPosRef.current[id]
        if (target) {
          mesh.position.x += (target.x - mesh.position.x) * 0.08
          mesh.position.z += (target.y - mesh.position.z) * 0.08
        }
      }
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelAnimationFrame(rafId)
      disposeScene(scene, renderer)
    }
  }, [canvasRef])

  return robotPosRef
}
```

- [ ] **Step 3: Write `frontend/components/FactoryCanvas.tsx`**

```typescript
"use client"
import { useRef } from "react"
import { useThreeScene } from "@/hooks/useThreeScene"

export function FactoryCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useThreeScene(canvasRef)

  return (
    <canvas
      ref={canvasRef}
      className="w-full rounded-lg"
      style={{ height: "500px" }}
    />
  )
}
```

- [ ] **Step 4: Mount `FactoryCanvas` in `frontend/app/page.tsx`**

```typescript
"use client"
import { useWebSocket } from "@/hooks/useWebSocket"
import { FactoryCanvas } from "@/components/FactoryCanvas"

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000/ws"

export default function Home() {
  useWebSocket(WS_URL)

  return (
    <main className="bg-gray-950 text-white min-h-screen p-4">
      <h1 className="text-2xl font-bold mb-4">SDF Digital Twin</h1>
      <FactoryCanvas />
    </main>
  )
}
```

- [ ] **Step 5: Verify visually**

```bash
cd frontend && npm run dev
```

Open `http://localhost:3000`. Expected: dark background with a 20×20 grid, 5 blue machine boxes, 3 green robot cylinders. No console errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/threeHelpers.ts frontend/hooks/useThreeScene.ts frontend/components/FactoryCanvas.tsx frontend/app/page.tsx
git commit -m "feat: Three.js static factory scene with machines and robots"
```

---

### Task 8: Robot Live Position Updates

**Files:**
- Modify: `frontend/hooks/useWebSocket.ts`
- Modify: `frontend/hooks/useThreeScene.ts`
- Modify: `frontend/app/page.tsx`

- [ ] **Step 1: Export `robotPosRef` from `useThreeScene` and accept it in `useWebSocket`**

Update `frontend/hooks/useWebSocket.ts` to accept a `robotPosRef`:

```typescript
"use client"
import { useEffect, useRef } from "react"
import { useFactoryStore } from "@/store/factoryStore"
import type { WSMessage, RobotState } from "@/lib/types"
import type { RobotPositionRef } from "@/hooks/useThreeScene"

export function useWebSocket(url: string, robotPosRef?: React.MutableRefObject<RobotPositionRef>) {
  const queueRef = useRef<WSMessage[]>([])
  const rafRef = useRef<number>(0)

  useEffect(() => {
    const store = useFactoryStore.getState()
    const ws = new WebSocket(url)

    ws.onmessage = (e) => {
      try {
        queueRef.current.push(JSON.parse(e.data) as WSMessage)
      } catch {}
    }

    const drain = () => {
      const batch = queueRef.current.splice(0)
      for (const msg of batch) {
        if (msg.type === "sensor_update") {
          // Write robot positions directly to ref — bypass React
          if (robotPosRef) {
            for (const [id, robot] of Object.entries(msg.payload.robots as Record<string, RobotState>)) {
              robotPosRef.current[id] = { x: robot.x, y: robot.y }
            }
          }
          store.applySnapshot(msg.payload)
        } else if (msg.type === "agent_event") {
          store.addAgentEvent(msg.payload)
        } else if (msg.type === "alert") {
          store.setActiveAlert(msg.payload)
        } else if (msg.type === "robot_dispatch") {
          store.setDispatchCommand(msg.payload)
        }
      }
      rafRef.current = requestAnimationFrame(drain)
    }

    rafRef.current = requestAnimationFrame(drain)

    return () => {
      ws.close()
      cancelAnimationFrame(rafRef.current)
    }
  }, [url])
}
```

- [ ] **Step 2: Pass `robotPosRef` from `page.tsx`**

```typescript
"use client"
import { useRef } from "react"
import { useWebSocket } from "@/hooks/useWebSocket"
import { useThreeScene } from "@/hooks/useThreeScene"
import { FactoryCanvas } from "@/components/FactoryCanvas"
import type { RobotPositionRef } from "@/hooks/useThreeScene"

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000/ws"

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const robotPosRef = useThreeScene(canvasRef)
  useWebSocket(WS_URL, robotPosRef)

  return (
    <main className="bg-gray-950 text-white min-h-screen p-4">
      <h1 className="text-2xl font-bold mb-4">SDF Digital Twin</h1>
      <FactoryCanvas canvasRef={canvasRef} />
    </main>
  )
}
```

- [ ] **Step 3: Update `FactoryCanvas` to accept `canvasRef` as prop**

```typescript
"use client"
import type { RefObject } from "react"

interface Props {
  canvasRef: RefObject<HTMLCanvasElement>
}

export function FactoryCanvas({ canvasRef }: Props) {
  return (
    <canvas
      ref={canvasRef}
      className="w-full rounded-lg"
      style={{ height: "500px" }}
    />
  )
}
```

- [ ] **Step 4: Remove `useThreeScene` call from `FactoryCanvas`**

`FactoryCanvas` no longer calls `useThreeScene` — it receives `canvasRef` as a prop. `page.tsx` owns the scene.

- [ ] **Step 5: Verify robots move**

With both backend and frontend running, robots should now smoothly interpolate their positions on the 3D floor. The backend currently keeps robots stationary (positions don't change in the simulator yet) — but confirm no console errors and the Three.js scene renders without crashes.

- [ ] **Step 6: Commit**

```bash
git add frontend/hooks/useWebSocket.ts frontend/hooks/useThreeScene.ts frontend/components/FactoryCanvas.tsx frontend/app/page.tsx
git commit -m "feat: robot live position updates via ref bypass (no React re-render)"
```

---

### Task 9: ECharts Sensor Charts

**Files:**
- Create: `frontend/components/SensorChart.tsx`
- Modify: `frontend/app/page.tsx`

- [ ] **Step 1: Write `frontend/components/SensorChart.tsx`**

```typescript
"use client"
import { useEffect, useRef } from "react"
import * as echarts from "echarts"
import { useFactoryStore } from "@/store/factoryStore"

interface Props {
  machineId: string
}

export function SensorChart({ machineId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)
  const lastUpdateRef = useRef(0)

  useEffect(() => {
    if (!containerRef.current) return
    chartRef.current = echarts.init(containerRef.current, "dark")
    chartRef.current.setOption({
      backgroundColor: "transparent",
      animation: false,
      grid: { left: 40, right: 10, top: 20, bottom: 20 },
      xAxis: { type: "time", splitLine: { show: false } },
      yAxis: { type: "value", min: 0, max: 250, splitLine: { lineStyle: { color: "#374151" } } },
      series: [{ type: "line", data: [], smooth: true, symbol: "none", lineStyle: { color: "#3b82f6", width: 1.5 } }],
    })

    return () => {
      chartRef.current?.dispose()
    }
  }, [])

  useEffect(() => {
    const unsub = useFactoryStore.subscribe(
      (state) => state.machines[machineId]?.history,
      (history) => {
        const now = Date.now()
        if (!history || now - lastUpdateRef.current < 250) return
        lastUpdateRef.current = now
        chartRef.current?.setOption(
          { series: [{ data: history }] },
          { notMerge: false }
        )
      }
    )
    return unsub
  }, [machineId])

  return (
    <div className="bg-gray-900 rounded-lg p-2">
      <p className="text-xs text-gray-400 mb-1">{machineId} — Vibration (Hz)</p>
      <div ref={containerRef} style={{ width: "100%", height: 100 }} />
    </div>
  )
}
```

- [ ] **Step 2: Add sensor charts grid to `frontend/app/page.tsx`**

```typescript
"use client"
import { useRef } from "react"
import { useWebSocket } from "@/hooks/useWebSocket"
import { useThreeScene } from "@/hooks/useThreeScene"
import { FactoryCanvas } from "@/components/FactoryCanvas"
import { SensorChart } from "@/components/SensorChart"

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000/ws"
const MACHINES = ["M1", "M2", "M3", "M4", "M5"]

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const robotPosRef = useThreeScene(canvasRef)
  useWebSocket(WS_URL, robotPosRef)

  return (
    <main className="bg-gray-950 text-white min-h-screen p-4 space-y-4">
      <h1 className="text-2xl font-bold">SDF Digital Twin</h1>
      <FactoryCanvas canvasRef={canvasRef} />
      <div className="grid grid-cols-5 gap-2">
        {MACHINES.map((id) => <SensorChart key={id} machineId={id} />)}
      </div>
    </main>
  )
}
```

- [ ] **Step 3: Verify visually**

Expected: 5 small ECharts graphs below the 3D scene, each showing a live vibration line updating every ~250ms. When the backend injects a fault spike, the affected chart should spike visibly.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/SensorChart.tsx frontend/app/page.tsx
git commit -m "feat: ECharts sensor charts with 4Hz throttled Zustand subscriptions"
```

---

## Phase 3: Multi-Agent AI Chain

### Task 10: Agent A — Diagnostic

**Files:**
- Create: `backend/agents/agent_a.py`
- Create: `backend/tests/test_agents.py`

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/test_agents.py
import pytest
from agents.agent_a import parse_agent_a_response

def test_parse_valid_response():
    raw = '{"severity": "high", "classification": "bearing_fault", "affected_components": ["spindle"], "confidence": 0.92}'
    result = parse_agent_a_response(raw)
    assert result.severity == "high"
    assert result.confidence == 0.92

def test_parse_response_with_surrounding_text():
    raw = 'Here is my analysis:\n{"severity": "medium", "classification": "overheating", "affected_components": ["motor"], "confidence": 0.75}\nEnd.'
    result = parse_agent_a_response(raw)
    assert result.severity == "medium"

def test_parse_invalid_returns_fallback():
    result = parse_agent_a_response("I cannot determine the issue.")
    assert result.severity == "unknown"
    assert result.confidence == 0.0
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_agents.py -v
```

Expected: `ModuleNotFoundError: No module named 'agents.agent_a'`

- [ ] **Step 3: Write `backend/agents/agent_a.py`**

```python
import asyncio
import json
import re
import time
from dataclasses import dataclass
from anthropic import AsyncAnthropic

@dataclass
class AnomalyReport:
    severity: str           # "low" | "medium" | "high" | "unknown"
    classification: str
    affected_components: list[str]
    confidence: float
    fallback: bool = False

def parse_agent_a_response(text: str) -> AnomalyReport:
    match = re.search(r'\{[^{}]+\}', text, re.DOTALL)
    if not match:
        return AnomalyReport(severity="unknown", classification="parse_error", affected_components=[], confidence=0.0, fallback=True)
    try:
        data = json.loads(match.group())
        return AnomalyReport(
            severity=data.get("severity", "unknown"),
            classification=data.get("classification", "unknown"),
            affected_components=data.get("affected_components", []),
            confidence=float(data.get("confidence", 0.0)),
        )
    except Exception:
        return AnomalyReport(severity="unknown", classification="parse_error", affected_components=[], confidence=0.0, fallback=True)

async def run_agent_a(machine_id: str, sensor_history: list[dict], client: AsyncAnthropic) -> AnomalyReport:
    history_str = json.dumps(sensor_history[-30:], separators=(",", ":"))
    prompt = f"""You are a factory equipment diagnostics expert.

Machine ID: {machine_id}
Sensor readings (last 30 ticks, each: {{ts, vibration_hz, temperature_c, current_a}}):
{history_str}

Analyze the sensor data and identify the anomaly. Return ONLY valid JSON with no other text:
{{"severity": "low"|"medium"|"high", "classification": "<fault type>", "affected_components": ["<component>"], "confidence": <0.0-1.0>}}"""

    try:
        async with asyncio.timeout(10):
            response = await client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=256,
                messages=[{"role": "user", "content": prompt}],
            )
            return parse_agent_a_response(response.content[0].text)
    except Exception:
        return AnomalyReport(severity="unknown", classification="timeout", affected_components=[], confidence=0.0, fallback=True)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_agents.py -v
```

Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add backend/agents/agent_a.py backend/tests/test_agents.py
git commit -m "feat: Agent A diagnostic with Claude API and robust JSON parsing"
```

---

### Task 11: Agent B — Routing + Dispatch

**Files:**
- Create: `backend/agents/agent_b.py`
- Modify: `backend/tests/test_agents.py`

- [ ] **Step 1: Add failing tests to `backend/tests/test_agents.py`**

```python
from agents.agent_b import parse_agent_b_response

def test_parse_agent_b_valid():
    raw = '{"robotId": "R2", "path": [[5,5],[7,5],[7,3]], "eta_seconds": 4.2, "reasoning": "nearest idle robot"}'
    result = parse_agent_b_response(raw)
    assert result.robotId == "R2"
    assert len(result.path) == 3

def test_parse_agent_b_fallback():
    result = parse_agent_b_response("cannot determine")
    assert result.robotId == "R1"
    assert result.fallback is True
```

- [ ] **Step 2: Run to verify they fail**

```bash
pytest tests/test_agents.py::test_parse_agent_b_valid tests/test_agents.py::test_parse_agent_b_fallback -v
```

Expected: `ModuleNotFoundError: No module named 'agents.agent_b'`

- [ ] **Step 3: Write `backend/agents/agent_b.py`**

```python
import asyncio
import json
import re
from dataclasses import dataclass, field
from anthropic import AsyncAnthropic
from simulator.sensor_simulator import MACHINE_POSITIONS, ROBOT_POSITIONS
from agents.agent_a import AnomalyReport

@dataclass
class DispatchPlan:
    robotId: str
    path: list[list[float]]
    eta_seconds: float
    reasoning: str = ""
    fallback: bool = False

def parse_agent_b_response(text: str) -> DispatchPlan:
    match = re.search(r'\{.*\}', text, re.DOTALL)
    if not match:
        return DispatchPlan(robotId="R1", path=[], eta_seconds=10.0, fallback=True)
    try:
        data = json.loads(match.group())
        return DispatchPlan(
            robotId=data["robotId"],
            path=data.get("path", []),
            eta_seconds=float(data.get("eta_seconds", 10.0)),
            reasoning=data.get("reasoning", ""),
        )
    except Exception:
        return DispatchPlan(robotId="R1", path=[], eta_seconds=10.0, fallback=True)

async def run_agent_b(
    machine_id: str,
    report: AnomalyReport,
    robot_states: dict,
    client: AsyncAnthropic,
) -> DispatchPlan:
    machine_pos = MACHINE_POSITIONS[machine_id]
    idle_robots = [
        {"id": rid, "x": robot_states[rid]["x"], "y": robot_states[rid]["y"]}
        for rid in robot_states
        if robot_states[rid].get("status") == "idle"
    ] or [{"id": "R1", "x": 10, "y": 10}]

    prompt = f"""You are a factory floor robot dispatch system.

Factory grid: 20x20 units. 
Faulted machine: {machine_id} at position {machine_pos}.
Anomaly: {report.classification} (severity: {report.severity})

Available idle robots:
{json.dumps(idle_robots, separators=(",", ":"))}

Select the nearest idle robot and compute a direct waypoint path (3-5 waypoints) to the machine.
Return ONLY valid JSON:
{{"robotId": "<id>", "path": [[x,y],...], "eta_seconds": <float>, "reasoning": "<brief>"}}"""

    try:
        async with asyncio.timeout(10):
            response = await client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=256,
                messages=[{"role": "user", "content": prompt}],
            )
            return parse_agent_b_response(response.content[0].text)
    except Exception:
        return DispatchPlan(robotId="R1", path=[], eta_seconds=10.0, fallback=True)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_agents.py -v
```

Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add backend/agents/agent_b.py backend/tests/test_agents.py
git commit -m "feat: Agent B routing with nearest-robot dispatch and path planning"
```

---

### Task 12: Agent C — RICE Decision Report

**Files:**
- Create: `backend/agents/agent_c.py`
- Modify: `backend/tests/test_agents.py`

- [ ] **Step 1: Add failing tests**

```python
from agents.agent_c import parse_agent_c_response

def test_parse_agent_c_valid():
    raw = '''{
      "recommendation": "immediate_repair",
      "rice_scores": {
        "immediate": {"reach": 8, "impact": 9, "confidence": 0.9, "effort": 3, "score": 24.0},
        "scheduled": {"reach": 8, "impact": 6, "confidence": 0.8, "effort": 2, "score": 19.2},
        "bypass":    {"reach": 4, "impact": 3, "confidence": 0.6, "effort": 1, "score": 7.2}
      },
      "rationale": "High severity fault requires immediate action."
    }'''
    result = parse_agent_c_response(raw)
    assert result["recommendation"] == "immediate_repair"
    assert "immediate" in result["rice_scores"]

def test_parse_agent_c_fallback():
    result = parse_agent_c_response("I cannot determine")
    assert result["recommendation"] == "scheduled_maintenance"
    assert result["fallback"] is True
```

- [ ] **Step 2: Run to verify they fail**

```bash
pytest tests/test_agents.py::test_parse_agent_c_valid tests/test_agents.py::test_parse_agent_c_fallback -v
```

Expected: `ModuleNotFoundError: No module named 'agents.agent_c'`

- [ ] **Step 3: Write `backend/agents/agent_c.py`**

```python
import asyncio
import json
import re
from anthropic import AsyncAnthropic
from agents.agent_a import AnomalyReport
from agents.agent_b import DispatchPlan

def parse_agent_c_response(text: str) -> dict:
    match = re.search(r'\{.*\}', text, re.DOTALL)
    if not match:
        return {
            "recommendation": "scheduled_maintenance",
            "rice_scores": {},
            "rationale": "Could not compute. Defaulting to scheduled maintenance.",
            "fallback": True,
        }
    try:
        data = json.loads(match.group())
        return {
            "recommendation": data.get("recommendation", "scheduled_maintenance"),
            "rice_scores": data.get("rice_scores", {}),
            "rationale": data.get("rationale", ""),
            "fallback": False,
        }
    except Exception:
        return {
            "recommendation": "scheduled_maintenance",
            "rice_scores": {},
            "rationale": "Parse error. Defaulting to scheduled maintenance.",
            "fallback": True,
        }

async def run_agent_c(
    machine_id: str,
    report: AnomalyReport,
    dispatch: DispatchPlan,
    client: AsyncAnthropic,
) -> dict:
    prompt = f"""You are a factory operations decision analyst.

Faulted machine: {machine_id}
Fault classification: {report.classification} (severity: {report.severity}, confidence: {report.confidence})
Repair robot dispatched: {dispatch.robotId}, ETA: {dispatch.eta_seconds:.0f} seconds

Evaluate three action options using RICE scoring (score = reach * impact * confidence / effort):
1. immediate_repair — dispatch robot now, halt machine
2. scheduled_maintenance — queue for next maintenance window
3. temporary_bypass — reroute production, defer repair

Return ONLY valid JSON (no extra text):
{{
  "recommendation": "<option_key>",
  "rice_scores": {{
    "immediate":  {{"reach": <1-10>, "impact": <1-10>, "confidence": <0-1>, "effort": <1-10>, "score": <float>}},
    "scheduled":  {{"reach": <1-10>, "impact": <1-10>, "confidence": <0-1>, "effort": <1-10>, "score": <float>}},
    "bypass":     {{"reach": <1-10>, "impact": <1-10>, "confidence": <0-1>, "effort": <1-10>, "score": <float>}}
  }},
  "rationale": "<2-3 sentences>"
}}"""

    try:
        async with asyncio.timeout(10):
            response = await client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=512,
                messages=[{"role": "user", "content": prompt}],
            )
            return parse_agent_c_response(response.content[0].text)
    except Exception:
        return {
            "recommendation": "scheduled_maintenance",
            "rice_scores": {},
            "rationale": "Agent timeout. Defaulting to scheduled maintenance.",
            "fallback": True,
        }
```

- [ ] **Step 4: Run all agent tests**

```bash
pytest tests/test_agents.py -v
```

Expected: 7 passed

- [ ] **Step 5: Commit**

```bash
git add backend/agents/agent_c.py backend/tests/test_agents.py
git commit -m "feat: Agent C RICE decision report with three-option analysis"
```

---

### Task 13: AgentOrchestrator + Backend Wiring

**Files:**
- Create: `backend/agents/orchestrator.py`
- Modify: `backend/main.py`

- [ ] **Step 1: Write `backend/agents/orchestrator.py`**

```python
import asyncio
import time
import os
from anthropic import AsyncAnthropic
from gateway.event_bus import EventBus
from gateway.ws_gateway import WebSocketGateway
from simulator.sensor_simulator import SensorSimulator
from agents.agent_a import run_agent_a
from agents.agent_b import run_agent_b
from agents.agent_c import run_agent_c

class AgentOrchestrator:
    def __init__(self, bus: EventBus, gateway: WebSocketGateway, simulator: SensorSimulator):
        self._bus = bus
        self._gateway = gateway
        self._simulator = simulator
        self._client = AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
        self._running = False

    async def start(self):
        q = self._bus.subscribe()
        self._running = True
        while self._running:
            event = await q.get()
            if event["type"] == "anomaly_detected":
                asyncio.create_task(self._run_chain(event["machineId"]))

    async def _emit(self, agent_id: str, status: str, summary: str = ""):
        await self._gateway.broadcast({
            "type": "agent_event",
            "payload": {
                "agentId": agent_id,
                "status": status,
                "summary": summary,
                "ts": int(time.time() * 1000),
            }
        })

    async def _run_chain(self, machine_id: str):
        # Alert frontend
        await self._gateway.broadcast({
            "type": "alert",
            "payload": {"machineId": machine_id, "ts": int(time.time() * 1000)},
        })

        # Agent A
        await self._emit("A", "running")
        snapshot = self._simulator.tick()
        history = [
            {"ts": snapshot.ts, "vibration": snapshot.machines[machine_id].vibration,
             "temperature": snapshot.machines[machine_id].temperature,
             "current": snapshot.machines[machine_id].current}
        ]
        report = await run_agent_a(machine_id, history, self._client)
        await self._emit("A", "complete" if not report.fallback else "error",
                         f"{report.classification} ({report.severity} severity, {report.confidence:.0%} confidence)")

        # Agent B
        await self._emit("B", "running")
        robot_states = {rid: {"x": r.x, "y": r.y, "status": r.status}
                        for rid, r in snapshot.robots.items()}
        dispatch = await run_agent_b(machine_id, report, robot_states, self._client)
        await self._emit("B", "complete" if not dispatch.fallback else "error",
                         f"Dispatching {dispatch.robotId} → {machine_id} (ETA {dispatch.eta_seconds:.0f}s)")

        # Broadcast dispatch command for Three.js animation
        await self._gateway.broadcast({
            "type": "robot_dispatch",
            "payload": {
                "robotId": dispatch.robotId,
                "targetMachineId": machine_id,
                "path": dispatch.path,
                "estimatedArrival": dispatch.eta_seconds,
            }
        })

        # Agent C
        await self._emit("C", "running")
        rice = await run_agent_c(machine_id, report, dispatch, self._client)
        await self._emit("C", "complete" if not rice.get("fallback") else "error",
                         f"Recommendation: {rice['recommendation']}. {rice.get('rationale','')[:120]}")
```

- [ ] **Step 2: Add orchestrator to `backend/main.py` lifespan**

```python
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import asyncio, random, time, os
from dotenv import load_dotenv
from gateway.event_bus import EventBus
from gateway.ws_gateway import WebSocketGateway
from simulator.sensor_simulator import SensorSimulator
from agents.orchestrator import AgentOrchestrator

load_dotenv()

bus = EventBus()
gateway = WebSocketGateway()
simulator = SensorSimulator(seed=int(time.time()))
orchestrator = AgentOrchestrator(bus, gateway, simulator)

async def simulation_loop():
    next_fault_at = time.time() + random.uniform(60, 120)
    faulted_machine = None
    while True:
        now = time.time()
        if faulted_machine is None and now >= next_fault_at:
            faulted_machine = random.choice(["M1", "M2", "M3", "M4", "M5"])
            simulator.inject_fault(faulted_machine)
            await bus.publish({"type": "anomaly_detected", "machineId": faulted_machine})
        if faulted_machine and now >= next_fault_at + 30:
            simulator.clear_fault(faulted_machine)
            faulted_machine = None
            next_fault_at = now + random.uniform(60, 120)
        snapshot = simulator.tick()
        await bus.publish({"type": "sensor_update", "payload": snapshot.model_dump()})
        await asyncio.sleep(0.1)

async def broadcast_loop():
    q = bus.subscribe()
    while True:
        event = await q.get()
        if event["type"] == "sensor_update":
            await gateway.broadcast(event)

@asynccontextmanager
async def lifespan(app):
    tasks = [
        asyncio.create_task(simulation_loop()),
        asyncio.create_task(broadcast_loop()),
        asyncio.create_task(orchestrator.start()),
    ]
    yield
    for t in tasks:
        t.cancel()

app = FastAPI(title="SDF Digital Twin Backend", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://*.vercel.app"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {"status": "ok", "clients": gateway.client_count}

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await gateway.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        gateway.disconnect(ws)
```

- [ ] **Step 3: Add `.env` with real key**

```bash
cp backend/.env.example backend/.env
# Edit backend/.env and add your real ANTHROPIC_API_KEY
```

- [ ] **Step 4: Smoke test the agent chain**

```bash
cd backend && uvicorn main:app --reload --port 8000
```

Second terminal:
```bash
python -c "
import asyncio, websockets, json
async def test():
    async with websockets.connect('ws://localhost:8000/ws') as ws:
        print('Listening for agent events (wait up to 2 min for fault injection)...')
        async for raw in ws:
            msg = json.loads(raw)
            if msg['type'] != 'sensor_update':
                print(msg['type'], msg['payload'])
asyncio.run(test())
"
```

Expected after ~60-120 seconds: `alert`, then 3 `agent_event` messages (A running → complete, B running → complete, C running → complete), then `robot_dispatch`.

- [ ] **Step 5: Commit**

```bash
git add backend/agents/orchestrator.py backend/main.py backend/.env.example
git commit -m "feat: AgentOrchestrator wires A→B→C chain to WebSocket broadcast"
```

---

### Task 14: Agent Panel + Alert Banner UI

**Files:**
- Create: `frontend/components/AgentPanel.tsx`
- Create: `frontend/components/AlertBanner.tsx`
- Modify: `frontend/app/page.tsx`

- [ ] **Step 1: Write `frontend/components/AlertBanner.tsx`**

```typescript
"use client"
import { useFactoryStore } from "@/store/factoryStore"

export function AlertBanner() {
  const alert = useFactoryStore((s) => s.activeAlert)
  if (!alert) return null

  return (
    <div className="bg-red-900/80 border border-red-500 rounded-lg px-4 py-3 flex items-center gap-3">
      <span className="text-red-400 text-lg">⚠</span>
      <div>
        <p className="font-semibold text-red-200">Anomaly Detected</p>
        <p className="text-sm text-red-300">Machine {alert.machineId} — Agent chain initiated</p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Write `frontend/components/AgentPanel.tsx`**

```typescript
"use client"
import { useFactoryStore } from "@/store/factoryStore"
import type { AgentEvent } from "@/lib/types"

const AGENT_LABELS: Record<string, string> = {
  A: "Agent A — Diagnostic",
  B: "Agent B — Routing",
  C: "Agent C — Decision",
}

function AgentRow({ event }: { event: AgentEvent }) {
  const statusColor =
    event.status === "complete" ? "text-green-400"
    : event.status === "running" ? "text-yellow-400 animate-pulse"
    : "text-red-400"

  return (
    <div className="border border-gray-700 rounded-lg p-3 space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-200">{AGENT_LABELS[event.agentId]}</span>
        <span className={`text-xs font-mono ${statusColor}`}>{event.status}</span>
      </div>
      {event.summary && (
        <p className="text-xs text-gray-400 leading-relaxed">{event.summary}</p>
      )}
    </div>
  )
}

export function AgentPanel() {
  const events = useFactoryStore((s) => s.agentEvents)
  const dispatch = useFactoryStore((s) => s.dispatchCommand)

  if (events.length === 0) {
    return (
      <div className="bg-gray-900 rounded-lg p-4 text-gray-500 text-sm">
        Agents idle — waiting for anomaly detection...
      </div>
    )
  }

  return (
    <div className="bg-gray-900 rounded-lg p-4 space-y-3">
      <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Agent Chain</h2>
      <div className="space-y-2">
        {events.slice(-9).map((e, i) => <AgentRow key={i} event={e} />)}
      </div>
      {dispatch && (
        <div className="mt-3 border border-blue-800 rounded-lg p-3 bg-blue-950/40">
          <p className="text-xs text-blue-300 font-medium">Dispatch Active</p>
          <p className="text-xs text-blue-400 mt-1">
            {dispatch.robotId} → {dispatch.targetMachineId} · ETA {dispatch.estimatedArrival.toFixed(0)}s
          </p>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Update `frontend/app/page.tsx`**

```typescript
"use client"
import { useRef } from "react"
import { useWebSocket } from "@/hooks/useWebSocket"
import { useThreeScene } from "@/hooks/useThreeScene"
import { FactoryCanvas } from "@/components/FactoryCanvas"
import { SensorChart } from "@/components/SensorChart"
import { AgentPanel } from "@/components/AgentPanel"
import { AlertBanner } from "@/components/AlertBanner"

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000/ws"
const MACHINES = ["M1", "M2", "M3", "M4", "M5"]

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const robotPosRef = useThreeScene(canvasRef)
  useWebSocket(WS_URL, robotPosRef)

  return (
    <main className="bg-gray-950 text-white min-h-screen p-4 space-y-4">
      <h1 className="text-2xl font-bold">SDF Digital Twin</h1>
      <AlertBanner />
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 space-y-4">
          <FactoryCanvas canvasRef={canvasRef} />
          <div className="grid grid-cols-5 gap-2">
            {MACHINES.map((id) => <SensorChart key={id} machineId={id} />)}
          </div>
        </div>
        <div>
          <AgentPanel />
        </div>
      </div>
    </main>
  )
}
```

- [ ] **Step 4: End-to-end test**

With backend and frontend both running, wait for the fault injection cycle (~60-120s). Expected sequence:
1. A sensor chart spikes visually
2. Red AlertBanner appears at top
3. Agent Panel shows A → running → complete with summary
4. Agent Panel shows B → running → complete with dispatch info
5. A robot mesh in Three.js begins moving toward the faulted machine
6. Agent Panel shows C → running → complete with RICE recommendation

- [ ] **Step 5: Commit**

```bash
git add frontend/components/AgentPanel.tsx frontend/components/AlertBanner.tsx frontend/app/page.tsx
git commit -m "feat: AgentPanel and AlertBanner wired to Zustand for live chain display"
```

---

## Phase 4: Polish & Deploy

### Task 15: Machine Status Color in Three.js

**Files:**
- Modify: `frontend/lib/threeHelpers.ts`
- Modify: `frontend/hooks/useThreeScene.ts`
- Modify: `frontend/hooks/useWebSocket.ts`

- [ ] **Step 1: Add status material variants to `threeHelpers.ts`**

Add to the bottom of `frontend/lib/threeHelpers.ts`:

```typescript
export const STATUS_COLORS: Record<string, number> = {
  normal: 0x3b82f6,
  degraded: 0xf59e0b,
  fault: 0xef4444,
}

export function getMachineMaterial(status: string): THREE.MeshStandardMaterial {
  const key = `machine_${status}`
  return getMat(key, () =>
    new THREE.MeshStandardMaterial({ color: STATUS_COLORS[status] ?? 0x6b7280 })
  ) as THREE.MeshStandardMaterial
}
```

- [ ] **Step 2: Expose `machineMeshes` ref from `useThreeScene`**

In `frontend/hooks/useThreeScene.ts`, add a `machineMeshesRef` alongside `robotPosRef`:

```typescript
export interface MachineStatusRef {
  [machineId: string]: THREE.Mesh
}

// Inside useThreeScene, after building machine meshes:
const machineMeshesRef = useRef<MachineStatusRef>({})

// In the machines loop:
for (const [id, [x, z]] of Object.entries(MACHINE_POSITIONS)) {
  const mesh = buildMachineMesh(id)
  mesh.position.set(x, 0.6, z)
  scene.add(mesh)
  machineMeshesRef.current[id] = mesh   // ADD THIS
}

// Return both refs:
return { robotPosRef, machineMeshesRef }
```

Update `useThreeScene`'s return type:
```typescript
export function useThreeScene(canvasRef: React.RefObject<HTMLCanvasElement>): {
  robotPosRef: React.MutableRefObject<RobotPositionRef>
  machineMeshesRef: React.MutableRefObject<MachineStatusRef>
}
```

- [ ] **Step 3: Update `useWebSocket` to accept `machineMeshesRef` and update colors**

In `frontend/hooks/useWebSocket.ts`, add `machineMeshesRef` parameter:

```typescript
import { getMachineMaterial, type MachineStatusRef } from "@/lib/threeHelpers"

export function useWebSocket(
  url: string,
  robotPosRef?: React.MutableRefObject<RobotPositionRef>,
  machineMeshesRef?: React.MutableRefObject<MachineStatusRef>
) {
  // ...inside drain, in the sensor_update handler:
  if (machineMeshesRef) {
    for (const [id, data] of Object.entries(msg.payload.machines as Record<string, { status: string }>)) {
      const mesh = machineMeshesRef.current[id]
      if (mesh) {
        mesh.material = getMachineMaterial(data.status)
      }
    }
  }
```

- [ ] **Step 4: Pass `machineMeshesRef` from `page.tsx`**

```typescript
const { robotPosRef, machineMeshesRef } = useThreeScene(canvasRef)
useWebSocket(WS_URL, robotPosRef, machineMeshesRef)
```

- [ ] **Step 5: Verify visually**

Fault injection should now turn the affected machine red in the 3D scene. Degraded state turns it amber, normal stays blue.

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/threeHelpers.ts frontend/hooks/useThreeScene.ts frontend/hooks/useWebSocket.ts frontend/app/page.tsx
git commit -m "feat: machine status drives Three.js mesh color (normal/degraded/fault)"
```

---

### Task 16: Deployment Configuration

**Files:**
- Create: `backend/Procfile`
- Create: `frontend/vercel.json`
- Create: `railway.toml`

- [ ] **Step 1: Write `backend/Procfile` (Railway)**

```
web: uvicorn main:app --host 0.0.0.0 --port $PORT
```

- [ ] **Step 2: Write `railway.toml`**

```toml
[build]
builder = "nixpacks"

[deploy]
startCommand = "uvicorn main:app --host 0.0.0.0 --port $PORT"
restartPolicyType = "ON_FAILURE"

[[services]]
name = "backend"
rootDirectory = "backend"
```

- [ ] **Step 3: Write `frontend/vercel.json`**

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": ".next",
  "framework": "nextjs",
  "env": {
    "NEXT_PUBLIC_WS_URL": "@ws_url"
  }
}
```

- [ ] **Step 4: Deploy backend to Railway**

```bash
# Install Railway CLI if not installed:
npm install -g @railway/cli
railway login
railway init        # choose "Empty Project"
railway up          # deploys backend/
```

In Railway dashboard: add env variable `ANTHROPIC_API_KEY`.  
Copy the generated Railway URL (e.g., `https://sdf-backend.up.railway.app`).

- [ ] **Step 5: Deploy frontend to Vercel**

```bash
cd frontend
npx vercel
# When prompted: set NEXT_PUBLIC_WS_URL = wss://sdf-backend.up.railway.app/ws
```

Note: use `wss://` (not `ws://`) for the production WebSocket URL.

- [ ] **Step 6: Set up UptimeRobot keep-alive**

1. Go to uptimerobot.com → free account
2. Add monitor: HTTP, URL = `https://sdf-backend.up.railway.app/health`
3. Set check interval: 5 minutes
4. Expected response: `{"status":"ok"}`

- [ ] **Step 7: Smoke test production**

Visit your Vercel URL. Expected: full demo running with live sensor data from Railway backend. Wait ~2 minutes for first fault injection and agent chain run.

- [ ] **Step 8: Final commit**

```bash
git add backend/Procfile railway.toml frontend/vercel.json
git commit -m "feat: deployment config for Railway (backend) and Vercel (frontend)"
```

---

## Appendix: Running Tests

```bash
# Backend
cd backend
source .venv/bin/activate
pytest tests/ -v

# Frontend
cd frontend
npx vitest run
```

## Appendix: Full Local Run

```bash
# Terminal 1
cd backend && source .venv/bin/activate && uvicorn main:app --reload --port 8000

# Terminal 2
cd frontend && npm run dev
```

Visit `http://localhost:3000`. Wait 60-120 seconds for first agent chain trigger.
