# 동적 캔버스 & 인터랙티브 시각화 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 고정 공장 바닥을 동적 배치 캔버스로 전환하고, 기계/로봇 클릭 선택 시 부품별 상태 시각화와 로봇 경로를 3D로 렌더링한다.

**Architecture:** 백엔드는 기존 센서 스트림 유지 + 상세 구독 채널 추가. 프론트엔드는 placedEntities 기반 동적 렌더링, 레이캐스팅 선택, 서브메시 구조로 전환.

**Tech Stack:** 기존 스택 동일 (FastAPI, Next.js 14, Three.js, ECharts, Zustand) + THREE.LineDashedMaterial, THREE.Group 서브메시, ECharts heatmap

**전제 조건:** 2026-05-27-sdf-digital-twin.md 플랜의 Phase 1(백엔드 기반) 및 Phase 2(프론트엔드 기반)가 완료된 상태여야 합니다.

---

## 파일 맵

### 백엔드 (`backend/`)
| 파일 | 변경 |
|---|---|
| `gateway/ws_gateway.py` | `handle_client_message`, `broadcast_detail`, `_detail_subscriptions` 추가 |
| `simulator/detail_simulator.py` | **신규** — MachineDetail, RobotPathDetail 데이터 생성 |
| `agents/orchestrator.py` | `component_fault` 브로드캐스트 추가 |
| `main.py` | `detail_loop` 태스크, WS receive 라우팅 추가 |
| `tests/test_detail_simulator.py` | **신규** — 상세 데이터 생성 단위 테스트 |

### 프론트엔드 (`frontend/`)
| 파일 | 변경 |
|---|---|
| `lib/types.ts` | PlacedEntity, PaletteItem, MachineDetail, RobotPathDetail, ComponentFaultMap 추가 |
| `lib/threeHelpers.ts` | buildMachineGroup, buildPathLine, addSelectionOutline, removeSelectionOutline 추가 |
| `store/factoryStore.ts` | placedEntities, placementMode, selectedEntityId, 상세 데이터 필드 추가 |
| `hooks/useThreeScene.ts` | 레이캐스팅, 고스트 메시, 경로 라인, 서브메시 색상 추가 |
| `hooks/useWebSocket.ts` | 신규 메시지 타입 3개 처리 추가 |
| `components/Palette.tsx` | **신규** — 팔레트 사이드바 |
| `components/MachineDetailPanel.tsx` | **신규** — 기계 상세 패널 |
| `components/RobotDetailPanel.tsx` | **신규** — 로봇 상세 패널 |
| `app/page.tsx` | 레이아웃 변경, 신규 컴포넌트 마운트 |
| `__tests__/factoryStore.test.ts` | 배치/선택 액션 테스트 추가 |

---

## Phase 1: 백엔드 상세 구독 시스템

### Task 1: WebSocket 게이트웨이 — 구독 관리

**Files:**
- Modify: `backend/gateway/ws_gateway.py`

- [ ] **Step 1: `ws_gateway.py`에 구독 관리 추가**

```python
import json
from fastapi import WebSocket

class WebSocketGateway:
    def __init__(self):
        self._clients: set[WebSocket] = set()
        self._detail_subscriptions: dict[WebSocket, str] = {}

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._clients.add(ws)

    def disconnect(self, ws: WebSocket) -> None:
        self._clients.discard(ws)
        self._detail_subscriptions.pop(ws, None)

    async def handle_client_message(self, ws: WebSocket, raw: str) -> None:
        try:
            msg = json.loads(raw)
        except Exception:
            return
        if msg.get("type") == "subscribe_detail":
            self._detail_subscriptions[ws] = msg["payload"]["entityId"]
        elif msg.get("type") == "unsubscribe_detail":
            self._detail_subscriptions.pop(ws, None)

    async def broadcast(self, message: dict) -> None:
        data = json.dumps(message)
        dead: set[WebSocket] = set()
        for client in self._clients:
            try:
                await client.send_text(data)
            except Exception:
                dead.add(client)
        self._clients -= dead

    async def broadcast_detail(self, entity_id: str, message: dict) -> None:
        """entity_id를 구독 중인 클라이언트에만 전송"""
        data = json.dumps(message)
        dead: set[WebSocket] = set()
        for ws, eid in list(self._detail_subscriptions.items()):
            if eid == entity_id:
                try:
                    await ws.send_text(data)
                except Exception:
                    dead.add(ws)
        for ws in dead:
            self._clients.discard(ws)
            self._detail_subscriptions.pop(ws, None)

    @property
    def client_count(self) -> int:
        return len(self._clients)
```

- [ ] **Step 2: `main.py` WebSocket 핸들러 — receive 루프 활성화**

```python
@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await gateway.connect(ws)
    try:
        while True:
            raw = await ws.receive_text()
            await gateway.handle_client_message(ws, raw)
    except WebSocketDisconnect:
        gateway.disconnect(ws)
```

- [ ] **Step 3: 수동 스모크 테스트**

```bash
uvicorn main:app --reload --port 8000
```

```bash
python -c "
import asyncio, websockets, json
async def test():
    async with websockets.connect('ws://localhost:8000/ws') as ws:
        await ws.send(json.dumps({'type':'subscribe_detail','payload':{'entityId':'M1'}}))
        print('subscribe sent, no crash = pass')
asyncio.run(test())
"
```

Expected: `subscribe sent, no crash = pass`

- [ ] **Step 4: 커밋**

```bash
git add backend/gateway/ws_gateway.py backend/main.py
git commit -m "feat: WebSocket gateway subscription management for detail streaming"
```

---

### Task 2: 상세 데이터 시뮬레이터

**Files:**
- Create: `backend/simulator/detail_simulator.py`
- Create: `backend/tests/test_detail_simulator.py`

- [ ] **Step 1: 실패하는 테스트 작성**

```python
# backend/tests/test_detail_simulator.py
import pytest
from simulator.detail_simulator import DetailSimulator
from simulator.sensor_simulator import MACHINE_POSITIONS, ROBOT_POSITIONS

def test_machine_detail_has_all_parts():
    sim = DetailSimulator(seed=42)
    detail = sim.get_machine_detail("M1")
    assert set(detail["components"].keys()) == {"body", "motor", "actuator", "sensor_unit"}

def test_machine_detail_wear_in_range():
    sim = DetailSimulator(seed=42)
    detail = sim.get_machine_detail("M2")
    for part, data in detail["components"].items():
        assert 0 <= data["wear"] <= 100

def test_thermal_grid_shape():
    sim = DetailSimulator(seed=42)
    detail = sim.get_machine_detail("M3")
    assert len(detail["thermalGrid"]) == 4
    assert all(len(row) == 4 for row in detail["thermalGrid"])

def test_robot_path_detail_has_path():
    sim = DetailSimulator(seed=42)
    path = sim.get_robot_path("R1")
    assert "recommendedPath" in path
    assert isinstance(path["recommendedPath"], list)

def test_inject_fault_raises_wear():
    sim = DetailSimulator(seed=42)
    sim.inject_component_fault("M1", "motor")
    detail = sim.get_machine_detail("M1")
    assert detail["components"]["motor"]["status"] in ("warn", "critical")
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd backend && pytest tests/test_detail_simulator.py -v
```

Expected: `ModuleNotFoundError: No module named 'simulator.detail_simulator'`

- [ ] **Step 3: `backend/simulator/detail_simulator.py` 작성**

```python
import random
import time
import math
from simulator.sensor_simulator import MACHINE_POSITIONS, ROBOT_POSITIONS

PARTS = ["body", "motor", "actuator", "sensor_unit"]

class DetailSimulator:
    def __init__(self, seed: int = 0):
        self._rng = random.Random(seed)
        # 각 기계 파트의 기본 노후도 (고정값, 세션 내 변화 없음)
        self._base_wear: dict[str, dict[str, float]] = {
            mid: {p: self._rng.uniform(10, 70) for p in PARTS}
            for mid in MACHINE_POSITIONS
        }
        # 고장 주입된 파트
        self._faulted_parts: dict[str, set[str]] = {mid: set() for mid in MACHINE_POSITIONS}

    def inject_component_fault(self, machine_id: str, part: str) -> None:
        self._faulted_parts[machine_id].add(part)

    def clear_faults(self, machine_id: str) -> None:
        self._faulted_parts[machine_id].clear()

    def get_machine_detail(self, machine_id: str) -> dict:
        now = time.time()
        components = {}
        for part in PARTS:
            base = self._base_wear[machine_id][part]
            # 작은 노이즈 추가 (실시간 변동 효과)
            wear = min(100.0, base + self._rng.uniform(-1, 1))
            faulted = part in self._faulted_parts[machine_id]
            if faulted:
                wear = min(100.0, wear + self._rng.uniform(20, 35))

            temp_base = 40 + wear * 0.8
            temp = temp_base + self._rng.uniform(-3, 3) + (30 if faulted else 0)

            if faulted or wear >= 85:
                status = "critical"
            elif wear >= 65:
                status = "warn"
            else:
                status = "ok"

            components[part] = {
                "wear": round(wear, 1),
                "temperature": round(temp, 1),
                "status": status,
            }

        # 열분포 히트맵 (4×4)
        thermal_grid = []
        for r in range(4):
            row = []
            for c in range(4):
                base_temp = sum(v["temperature"] for v in components.values()) / len(components)
                val = (base_temp - 40) / 120  # 0~1 정규화
                noise = self._rng.uniform(-0.1, 0.1)
                row.append(round(max(0.0, min(1.0, val + noise)), 2))
            thermal_grid.append(row)

        # 가동률: 고장 파트가 있으면 낮아짐
        fault_count = len(self._faulted_parts[machine_id])
        operation_rate = max(0, 100 - fault_count * 25 + self._rng.uniform(-5, 5))

        return {
            "machineId": machine_id,
            "ts": int(now * 1000),
            "operationRate": round(operation_rate, 1),
            "components": components,
            "thermalGrid": thermal_grid,
        }

    def get_robot_path(self, robot_id: str) -> dict:
        pos = ROBOT_POSITIONS.get(robot_id, (10.0, 10.0))
        # 단순 순찰 경로: 현재 위치에서 가까운 4개 포인트
        patrol = [
            [pos[0], pos[1]],
            [pos[0] + 3, pos[1]],
            [pos[0] + 3, pos[1] + 3],
            [pos[0], pos[1] + 3],
            [pos[0], pos[1]],
        ]
        return {
            "robotId": robot_id,
            "currentPos": list(pos),
            "recommendedPath": patrol,
            "targetEntityId": None,
            "eta": 0,
            "pathType": "idle_patrol",
        }
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pytest tests/test_detail_simulator.py -v
```

Expected: 5 passed

- [ ] **Step 5: 커밋**

```bash
git add backend/simulator/detail_simulator.py backend/tests/test_detail_simulator.py
git commit -m "feat: DetailSimulator for component wear, thermal grid, robot path data"
```

---

### Task 3: 상세 스트리밍 루프 + 오케스트레이터 component_fault 연동

**Files:**
- Modify: `backend/main.py`
- Modify: `backend/agents/orchestrator.py`

- [ ] **Step 1: `main.py`에 detail_simulator 초기화 및 detail_loop 추가**

```python
# main.py 상단 import 추가
from simulator.detail_simulator import DetailSimulator

# 전역 인스턴스 추가 (bus, gateway, simulator 선언 아래)
detail_sim = DetailSimulator(seed=42)

# detail_loop 함수 추가
async def detail_loop():
    """구독 중인 엔티티에 상세 데이터를 2Hz로 스트리밍"""
    while True:
        subscribed = set(gateway._detail_subscriptions.values())
        for entity_id in subscribed:
            if entity_id.startswith("M"):
                detail = detail_sim.get_machine_detail(entity_id)
                await gateway.broadcast_detail(entity_id, {
                    "type": "machine_detail",
                    "payload": detail,
                })
            elif entity_id.startswith("R"):
                path = detail_sim.get_robot_path(entity_id)
                await gateway.broadcast_detail(entity_id, {
                    "type": "robot_path",
                    "payload": path,
                })
        await asyncio.sleep(0.5)   # 2Hz

# lifespan tasks에 detail_loop 추가
@asynccontextmanager
async def lifespan(app):
    tasks = [
        asyncio.create_task(simulation_loop()),
        asyncio.create_task(broadcast_loop()),
        asyncio.create_task(orchestrator.start()),
        asyncio.create_task(detail_loop()),    # 추가
    ]
    yield
    for t in tasks:
        t.cancel()
```

- [ ] **Step 2: `orchestrator.py`에 component_fault 브로드캐스트 추가**

`_run_chain()` 내 Agent A 완료 직후에 추가:

```python
# Agent A 완료 후
await self._emit("A", "complete" if not report.fallback else "error", ...)

# component_fault 브로드캐스트 추가
if not report.fallback and report.affected_components:
    faulted_parts = self._map_components_to_parts(report.affected_components, report.severity)
    await self._gateway.broadcast({
        "type": "component_fault",
        "payload": {
            "machineId": machine_id,
            "faultedParts": faulted_parts,
        }
    })
    # DetailSimulator에도 반영
    from simulator.detail_simulator import DetailSimulator
    # main.py에서 detail_sim을 전달받도록 orchestrator 생성자 수정
    if self._detail_sim:
        for part in faulted_parts:
            self._detail_sim.inject_component_fault(machine_id, part)
```

`AgentOrchestrator.__init__`에 `detail_sim` 파라미터 추가:

```python
class AgentOrchestrator:
    def __init__(self, bus, gateway, simulator, detail_sim=None):
        ...
        self._detail_sim = detail_sim
```

`main.py`에서:
```python
orchestrator = AgentOrchestrator(bus, gateway, simulator, detail_sim)
```

컴포넌트 → 파트 매핑 메서드 추가:

```python
def _map_components_to_parts(self, components: list[str], severity: str) -> dict:
    COMPONENT_PART_MAP = {
        "bearing": "motor",    "spindle": "motor",     "motor_surge": "motor",
        "hydraulic": "actuator", "press_head": "actuator", "belt": "actuator",
        "sensor": "sensor_unit",
        "temperature": "body", "overheating": "body",
    }
    result = {}
    for c in components:
        part = COMPONENT_PART_MAP.get(c.lower(), "body")
        result[part] = {
            "severity": "critical" if severity == "high" else "warn",
            "description": c,
        }
    return result
```

고장 해제 시 DetailSimulator clear:

```python
# simulation_loop()에서 fault clear 시
simulator.clear_fault(faulted_machine)
detail_sim.clear_faults(faulted_machine)   # 추가
```

- [ ] **Step 3: 스모크 테스트**

```bash
uvicorn main:app --reload --port 8000
```

```bash
python -c "
import asyncio, websockets, json
async def test():
    async with websockets.connect('ws://localhost:8000/ws') as ws:
        await ws.send(json.dumps({'type':'subscribe_detail','payload':{'entityId':'M2'}}))
        for _ in range(5):
            msg = json.loads(await ws.recv())
            if msg['type'] == 'machine_detail':
                print('machine_detail OK:', list(msg['payload']['components'].keys()))
                break
asyncio.run(test())
"
```

Expected: `machine_detail OK: ['body', 'motor', 'actuator', 'sensor_unit']`

- [ ] **Step 4: 커밋**

```bash
git add backend/main.py backend/agents/orchestrator.py
git commit -m "feat: detail streaming loop 2Hz + component_fault broadcast on Agent A"
```

---

## Phase 2: 프론트엔드 타입 + 스토어 확장

### Task 4: 타입 + Zustand 스토어 확장

**Files:**
- Modify: `frontend/lib/types.ts`
- Modify: `frontend/store/factoryStore.ts`
- Modify: `frontend/__tests__/factoryStore.test.ts`

- [ ] **Step 1: `lib/types.ts`에 신규 타입 추가**

기존 파일 끝에 추가:

```typescript
// 배치 시스템
export type MachineType = "press" | "cnc" | "conveyor"
export type EntityType = MachineType | "robot"

export interface PlacedEntity {
  id: string
  type: EntityType
  x: number
  z: number
  label: string
}

export interface PaletteItem {
  poolId: string
  type: EntityType
  label: string
  isPlaced: boolean
}

// 상세 데이터
export interface ComponentStatus {
  wear: number
  temperature: number
  status: "ok" | "warn" | "critical"
}

export interface MachineDetail {
  machineId: string
  ts: number
  operationRate: number
  components: Record<string, ComponentStatus>
  thermalGrid: number[][]
}

export interface RobotPathDetail {
  robotId: string
  currentPos: [number, number]
  recommendedPath: [number, number][]
  targetEntityId: string | null
  eta: number
  pathType: "idle_patrol" | "dispatch" | "returning"
}

export interface ComponentFaultMap {
  machineId: string
  faultedParts: Record<string, {
    severity: "warn" | "critical"
    description: string
  }>
}

// WSMessage 확장
// (기존 WSMessage union에 3개 추가)
```

기존 `WSMessage` type에 추가:
```typescript
export type WSMessage =
  | { type: "sensor_update";    payload: SensorSnapshot }
  | { type: "robot_dispatch";   payload: DispatchCommand }
  | { type: "agent_event";      payload: AgentEvent }
  | { type: "alert";            payload: Alert }
  | { type: "machine_detail";   payload: MachineDetail }      // 신규
  | { type: "robot_path";       payload: RobotPathDetail }    // 신규
  | { type: "component_fault";  payload: ComponentFaultMap }  // 신규
```

- [ ] **Step 2: 실패하는 스토어 테스트 추가**

`__tests__/factoryStore.test.ts`에 추가:

```typescript
describe("placement", () => {
  it("places an entity", () => {
    useFactoryStore.getState().placeEntity("M1", "press", 5, 3)
    const { placedEntities } = useFactoryStore.getState()
    expect(placedEntities).toHaveLength(1)
    expect(placedEntities[0].id).toBe("M1")
  })

  it("prevents duplicate placement", () => {
    useFactoryStore.getState().placeEntity("M1", "press", 5, 3)
    useFactoryStore.getState().placeEntity("M1", "press", 7, 7)
    expect(useFactoryStore.getState().placedEntities).toHaveLength(1)
  })

  it("removes an entity", () => {
    useFactoryStore.getState().placeEntity("M2", "cnc", 5, 5)
    useFactoryStore.getState().removeEntity("M2")
    expect(useFactoryStore.getState().placedEntities).toHaveLength(0)
  })
})

describe("selection", () => {
  it("sets selectedEntityId", () => {
    useFactoryStore.getState().selectEntity("M3")
    expect(useFactoryStore.getState().selectedEntityId).toBe("M3")
  })

  it("clears selection", () => {
    useFactoryStore.getState().selectEntity("M3")
    useFactoryStore.getState().selectEntity(null)
    expect(useFactoryStore.getState().selectedEntityId).toBeNull()
  })
})
```

- [ ] **Step 3: 테스트 실패 확인**

```bash
cd frontend && npx vitest run __tests__/factoryStore.test.ts
```

Expected: `TypeError: useFactoryStore.getState().placeEntity is not a function`

- [ ] **Step 4: `store/factoryStore.ts` 확장**

```typescript
import { create } from "zustand"
import type {
  MachineState, RobotState, AgentEvent, Alert, DispatchCommand,
  SensorSnapshot, PlacedEntity, EntityType, MachineDetail,
  RobotPathDetail, ComponentFaultMap,
} from "@/lib/types"

const HISTORY_MAX = 300

interface FactoryStore {
  // 기존
  machines: Record<string, MachineState>
  robots: Record<string, RobotState>
  agentEvents: AgentEvent[]
  activeAlert: Alert | null
  dispatchCommand: DispatchCommand | null
  applySnapshot: (snapshot: SensorSnapshot) => void
  addAgentEvent: (event: AgentEvent) => void
  setActiveAlert: (alert: Alert | null) => void
  setDispatchCommand: (cmd: DispatchCommand | null) => void

  // 배치
  placedEntities: PlacedEntity[]
  placementMode: { type: EntityType; poolId: string } | null
  enterPlacementMode: (type: EntityType, poolId: string) => void
  exitPlacementMode: () => void
  placeEntity: (poolId: string, type: EntityType, x: number, z: number) => void
  removeEntity: (poolId: string) => void

  // 선택
  selectedEntityId: string | null
  selectEntity: (id: string | null) => void

  // 상세 데이터
  machineDetails: Record<string, MachineDetail>
  robotPaths: Record<string, RobotPathDetail>
  componentFaults: Record<string, ComponentFaultMap>
  setMachineDetail: (detail: MachineDetail) => void
  setRobotPath: (path: RobotPathDetail) => void
  setComponentFault: (fault: ComponentFaultMap) => void
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

  addAgentEvent: (event) =>
    set((state) => ({ agentEvents: [...state.agentEvents, event] })),
  setActiveAlert: (alert) => set({ activeAlert: alert }),
  setDispatchCommand: (cmd) => set({ dispatchCommand: cmd }),

  // 배치
  placedEntities: [],
  placementMode: null,
  enterPlacementMode: (type, poolId) => set({ placementMode: { type, poolId } }),
  exitPlacementMode: () => set({ placementMode: null }),
  placeEntity: (poolId, type, x, z) =>
    set((state) => {
      if (state.placedEntities.some((e) => e.id === poolId)) return {}
      return {
        placedEntities: [...state.placedEntities, { id: poolId, type, x, z, label: poolId }],
        placementMode: null,
      }
    }),
  removeEntity: (poolId) =>
    set((state) => ({
      placedEntities: state.placedEntities.filter((e) => e.id !== poolId),
    })),

  // 선택
  selectedEntityId: null,
  selectEntity: (id) => set({ selectedEntityId: id }),

  // 상세 데이터
  machineDetails: {},
  robotPaths: {},
  componentFaults: {},
  setMachineDetail: (detail) =>
    set((state) => ({ machineDetails: { ...state.machineDetails, [detail.machineId]: detail } })),
  setRobotPath: (path) =>
    set((state) => ({ robotPaths: { ...state.robotPaths, [path.robotId]: path } })),
  setComponentFault: (fault) =>
    set((state) => ({ componentFaults: { ...state.componentFaults, [fault.machineId]: fault } })),
}))
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
npx vitest run __tests__/factoryStore.test.ts
```

Expected: 전체 통과

- [ ] **Step 6: 커밋**

```bash
git add frontend/lib/types.ts frontend/store/factoryStore.ts frontend/__tests__/factoryStore.test.ts
git commit -m "feat: types and Zustand store — placement, selection, detail data"
```

---

## Phase 3: Three.js 서브메시 + 선택 + 경로

### Task 5: threeHelpers — 서브메시 빌더 + 선택 outline + 경로 라인

**Files:**
- Modify: `frontend/lib/threeHelpers.ts`

- [ ] **Step 1: 기존 `threeHelpers.ts`에 서브메시 정의 추가**

파일 끝에 추가:

```typescript
import type { MachineType } from "@/lib/types"

interface SubMeshDef {
  name: string
  geo: () => THREE.BufferGeometry
  position: [number, number, number]
}

const MACHINE_SUBMESH_DEFS: Record<MachineType, SubMeshDef[]> = {
  press: [
    { name: "body",        geo: () => new THREE.BoxGeometry(1.4, 0.6, 1.4),         position: [0, 0.3, 0] },
    { name: "motor",       geo: () => new THREE.CylinderGeometry(0.2, 0.2, 0.8, 8), position: [0, 1.0, 0] },
    { name: "actuator",    geo: () => new THREE.BoxGeometry(0.6, 0.5, 0.6),         position: [0, 1.6, 0] },
    { name: "sensor_unit", geo: () => new THREE.SphereGeometry(0.15, 8, 8),         position: [0.6, 1.1, 0.6] },
  ],
  cnc: [
    { name: "body",        geo: () => new THREE.BoxGeometry(1.2, 1.2, 1.2),          position: [0, 0.6, 0] },
    { name: "motor",       geo: () => new THREE.CylinderGeometry(0.18, 0.18, 1.0, 8),position: [-0.7, 0.8, 0] },
    { name: "actuator",    geo: () => new THREE.BoxGeometry(0.4, 0.6, 0.4),          position: [0, 1.5, 0] },
    { name: "sensor_unit", geo: () => new THREE.SphereGeometry(0.15, 8, 8),          position: [0.5, 1.3, 0.5] },
  ],
  conveyor: [
    { name: "body",        geo: () => new THREE.BoxGeometry(2.4, 0.3, 0.8),         position: [0, 0.15, 0] },
    { name: "motor",       geo: () => new THREE.CylinderGeometry(0.2, 0.2, 0.5, 8), position: [1.1, 0.4, 0] },
    { name: "actuator",    geo: () => new THREE.BoxGeometry(2.2, 0.1, 0.6),         position: [0, 0.35, 0] },
    { name: "sensor_unit", geo: () => new THREE.SphereGeometry(0.12, 8, 8),         position: [0, 0.5, 0.4] },
  ],
}

export function buildMachineGroup(poolId: string, type: MachineType): THREE.Group {
  const group = new THREE.Group()
  group.userData.entityId = poolId
  group.userData.entityType = "machine"

  const baseMat = getMat("machine_part_base", () =>
    new THREE.MeshStandardMaterial({ color: 0x3b82f6 })
  ) as THREE.MeshStandardMaterial

  for (const def of MACHINE_SUBMESH_DEFS[type]) {
    const mesh = new THREE.Mesh(def.geo(), baseMat.clone())
    mesh.name = def.name
    mesh.userData.partName = def.name
    mesh.position.set(...def.position)
    group.add(mesh)
  }
  return group
}

export function buildRobotMesh(poolId: string): THREE.Mesh {
  const geo = getGeo("robot", () => new THREE.CylinderGeometry(0.3, 0.3, 0.4, 8))
  const mat = getMat("robot", () =>
    new THREE.MeshStandardMaterial({ color: 0x10b981 })
  )
  const mesh = new THREE.Mesh(geo, mat)
  mesh.userData.entityId = poolId
  mesh.userData.entityType = "robot"
  return mesh
}

// 선택 outline
export function addSelectionOutline(target: THREE.Object3D): void {
  removeSelectionOutline(target)
  const mat = getMat("selection_outline", () =>
    new THREE.LineBasicMaterial({ color: 0xfbbf24 })
  ) as THREE.LineBasicMaterial

  target.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      const edges = new THREE.EdgesGeometry(obj.geometry)
      const outline = new THREE.LineSegments(edges, mat)
      outline.name = "__sel_outline__"
      obj.add(outline)
    }
  })
}

export function removeSelectionOutline(target: THREE.Object3D): void {
  target.traverse((obj) => {
    const outline = obj.getObjectByName("__sel_outline__")
    if (outline) obj.remove(outline)
  })
}

// 경로 라인
export function buildPathLine(path: [number, number][]): THREE.Line {
  const points = path.map(([x, z]) => new THREE.Vector3(x, 0.15, z))
  const geo = new THREE.BufferGeometry().setFromPoints(points)
  const mat = getMat("path_line", () =>
    new THREE.LineDashedMaterial({ color: 0x10b981, dashSize: 0.4, gapSize: 0.2 })
  ) as THREE.LineDashedMaterial
  const line = new THREE.Line(geo, mat)
  line.computeLineDistances()
  line.name = `__path__`
  return line
}

// 서브메시 고장 색상 업데이트
export function applyComponentFault(
  group: THREE.Group,
  faultedParts: Record<string, { severity: "warn" | "critical" }>
): void {
  group.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !obj.userData.partName) return
    const mat = obj.material as THREE.MeshStandardMaterial
    const fault = faultedParts[obj.userData.partName]
    if (fault) {
      mat.color.setHex(fault.severity === "critical" ? 0xef4444 : 0xf59e0b)
      mat.emissive.setHex(fault.severity === "critical" ? 0x7f1d1d : 0x78350f)
    } else {
      mat.color.setHex(0x3b82f6)
      mat.emissive.setHex(0x000000)
    }
  })
}
```

- [ ] **Step 2: 기존 `buildMachineMesh` 및 `buildRobotMesh` 제거**

기존 단일 메시 빌더를 삭제하고 위의 신규 빌더로 대체합니다. `MACHINE_POSITIONS`, `ROBOT_START_POSITIONS` 상수는 유지.

- [ ] **Step 3: 커밋**

```bash
git add frontend/lib/threeHelpers.ts
git commit -m "feat: Three.js sub-mesh builders, selection outline, path line helpers"
```

---

### Task 6: useThreeScene — 동적 배치 + 레이캐스팅 + 경로 관리

**Files:**
- Modify: `frontend/hooks/useThreeScene.ts`

- [ ] **Step 1: `useThreeScene.ts` 전체 재작성**

```typescript
"use client"
import { useEffect, useRef } from "react"
import * as THREE from "three"
import {
  buildMachineGroup, buildRobotMesh, buildPathLine,
  addSelectionOutline, removeSelectionOutline, applyComponentFault,
  disposeScene, MACHINE_POSITIONS, ROBOT_START_POSITIONS,
} from "@/lib/threeHelpers"
import { useFactoryStore } from "@/store/factoryStore"
import type { MachineType, PlacedEntity } from "@/lib/types"

export interface RobotPositionRef {
  [robotId: string]: { x: number; y: number }
}
export interface MachineGroupRef {
  [machineId: string]: THREE.Group
}
export interface RobotMeshRef {
  [robotId: string]: THREE.Mesh
}

export function useThreeScene(canvasRef: React.RefObject<HTMLCanvasElement>) {
  const robotPosRef = useRef<RobotPositionRef>({})
  const machineGroupsRef = useRef<MachineGroupRef>({})
  const robotMeshesRef = useRef<RobotMeshRef>({})
  const pathLinesRef = useRef<Record<string, THREE.Line>>({})
  const ghostRef = useRef<THREE.Group | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x111827)
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.1, 1000)
    camera.position.set(10, 20, 20)
    camera.lookAt(10, 0, 10)

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    renderer.setSize(canvas.clientWidth, canvas.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

    scene.add(new THREE.AmbientLight(0xffffff, 0.6))
    const dir = new THREE.DirectionalLight(0xffffff, 0.8)
    dir.position.set(10, 20, 10)
    scene.add(dir)

    const grid = new THREE.GridHelper(22, 22, 0x374151, 0x1f2937)
    grid.position.set(10, 0, 10)
    scene.add(grid)

    // 보이지 않는 바닥 평면 (레이캐스팅용)
    const floorGeo = new THREE.PlaneGeometry(22, 22)
    const floorMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
    const floor = new THREE.Mesh(floorGeo, floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.position.set(10, 0, 10)
    floor.name = "__floor__"
    scene.add(floor)

    const raycaster = new THREE.Raycaster()

    // 마우스 이동 — 고스트 메시 위치 업데이트
    const onMouseMove = (e: MouseEvent) => {
      const store = useFactoryStore.getState()
      if (!store.placementMode) {
        if (ghostRef.current) {
          scene.remove(ghostRef.current)
          ghostRef.current = null
        }
        return
      }

      const rect = canvas.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(ndc, camera)
      const hits = raycaster.intersectObject(floor)
      if (!hits.length) return

      const { x, z } = hits[0].point

      // 고스트 메시 생성 또는 업데이트
      if (!ghostRef.current) {
        const type = store.placementMode.type
        const ghost = type === "robot"
          ? new THREE.Group()
          : buildMachineGroup("ghost", type as MachineType)
        ghost.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            ;(obj.material as THREE.MeshStandardMaterial).opacity = 0.4
            ;(obj.material as THREE.MeshStandardMaterial).transparent = true
          }
        })
        ghostRef.current = ghost
        scene.add(ghost)
      }

      ghostRef.current.position.set(x, 0, z)

      // 겹침 검사
      const tooClose = store.placedEntities.some((e) => {
        const dx = e.x - x, dz = e.z - z
        return Math.sqrt(dx * dx + dz * dz) < 1.5
      })
      ghostRef.current.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          ;(obj.material as THREE.MeshStandardMaterial).color.setHex(
            tooClose ? 0xef4444 : 0x3b82f6
          )
        }
      })
    }

    // 클릭 — 배치 또는 선택
    const onClick = (e: MouseEvent) => {
      const store = useFactoryStore.getState()
      const rect = canvas.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(ndc, camera)

      if (store.placementMode) {
        // 배치 모드: 바닥 클릭 → 엔티티 배치
        const hits = raycaster.intersectObject(floor)
        if (!hits.length) return
        const { x, z } = hits[0].point

        const tooClose = store.placedEntities.some((en) => {
          const dx = en.x - x, dz = en.z - z
          return Math.sqrt(dx * dx + dz * dz) < 1.5
        })
        if (tooClose) return

        store.placeEntity(store.placementMode.poolId, store.placementMode.type, x, z)
        if (ghostRef.current) { scene.remove(ghostRef.current); ghostRef.current = null }
        return
      }

      // 선택 모드: 배치된 엔티티 클릭
      const allMeshes = [
        ...Object.values(machineGroupsRef.current),
        ...Object.values(robotMeshesRef.current),
      ]
      const hits = raycaster.intersectObjects(allMeshes, true)

      // 이전 선택 해제
      const prev = store.selectedEntityId
      if (prev) {
        const prevGroup = machineGroupsRef.current[prev] ?? robotMeshesRef.current[prev]
        if (prevGroup) removeSelectionOutline(prevGroup)
      }

      if (!hits.length) {
        store.selectEntity(null)
        return
      }

      let obj: THREE.Object3D | null = hits[0].object
      while (obj && !obj.userData.entityId) obj = obj.parent ?? null
      if (!obj?.userData.entityId) return

      const entityId = obj.userData.entityId as string
      store.selectEntity(entityId)
      addSelectionOutline(obj)
    }

    canvas.addEventListener("mousemove", onMouseMove)
    canvas.addEventListener("click", onClick)

    // RAF 애니메이션 루프
    let rafId: number
    const animate = () => {
      rafId = requestAnimationFrame(animate)

      // 배치된 엔티티 씬 동기화
      const store = useFactoryStore.getState()
      for (const entity of store.placedEntities) {
        if (entity.type === "robot") {
          if (!robotMeshesRef.current[entity.id]) {
            const mesh = buildRobotMesh(entity.id)
            mesh.position.set(entity.x, 0.2, entity.z)
            scene.add(mesh)
            robotMeshesRef.current[entity.id] = mesh
            robotPosRef.current[entity.id] = { x: entity.x, y: entity.z }
          }
          // 로봇 위치 보간
          const target = robotPosRef.current[entity.id]
          const mesh = robotMeshesRef.current[entity.id]
          if (target && mesh) {
            mesh.position.x += (target.x - mesh.position.x) * 0.08
            mesh.position.z += (target.y - mesh.position.z) * 0.08
          }
        } else {
          if (!machineGroupsRef.current[entity.id]) {
            const group = buildMachineGroup(entity.id, entity.type as MachineType)
            group.position.set(entity.x, 0, entity.z)
            scene.add(group)
            machineGroupsRef.current[entity.id] = group
          }
        }
      }

      // 제거된 엔티티 씬에서 삭제
      for (const id of Object.keys(machineGroupsRef.current)) {
        if (!store.placedEntities.find((e) => e.id === id)) {
          scene.remove(machineGroupsRef.current[id])
          delete machineGroupsRef.current[id]
        }
      }
      for (const id of Object.keys(robotMeshesRef.current)) {
        if (!store.placedEntities.find((e) => e.id === id)) {
          scene.remove(robotMeshesRef.current[id])
          delete robotMeshesRef.current[id]
        }
      }

      renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelAnimationFrame(rafId)
      canvas.removeEventListener("mousemove", onMouseMove)
      canvas.removeEventListener("click", onClick)
      disposeScene(scene, renderer)
    }
  }, [canvasRef])

  // 경로 라인 업데이트 함수 (useWebSocket에서 호출)
  const updatePathLine = (robotId: string, path: [number, number][]) => {
    const scene = sceneRef.current
    if (!scene) return
    const prev = pathLinesRef.current[robotId]
    if (prev) { scene.remove(prev); prev.geometry.dispose() }
    if (path.length < 2) return
    const line = buildPathLine(path)
    scene.add(line)
    pathLinesRef.current[robotId] = line
  }

  const clearPathLine = (robotId: string) => {
    const scene = sceneRef.current
    if (!scene) return
    const line = pathLinesRef.current[robotId]
    if (line) { scene.remove(line); line.geometry.dispose(); delete pathLinesRef.current[robotId] }
  }

  const updateComponentFault = (machineId: string, faultedParts: Record<string, { severity: "warn" | "critical" }>) => {
    const group = machineGroupsRef.current[machineId]
    if (group) applyComponentFault(group, faultedParts)
  }

  return { robotPosRef, machineGroupsRef, updatePathLine, clearPathLine, updateComponentFault }
}
```

- [ ] **Step 2: `page.tsx`에서 반환값 시그니처 업데이트**

```typescript
const { robotPosRef, machineGroupsRef, updatePathLine, clearPathLine, updateComponentFault } = useThreeScene(canvasRef)
useWebSocket(WS_URL, robotPosRef, machineGroupsRef, updatePathLine, clearPathLine, updateComponentFault)
```

- [ ] **Step 3: 커밋**

```bash
git add frontend/hooks/useThreeScene.ts frontend/app/page.tsx
git commit -m "feat: dynamic placement, raycasting selection, ghost mesh, path line management"
```

---

### Task 7: useWebSocket — 신규 메시지 처리 + 구독 전송

**Files:**
- Modify: `frontend/hooks/useWebSocket.ts`

- [ ] **Step 1: `useWebSocket.ts` 전체 업데이트**

```typescript
"use client"
import { useEffect, useRef } from "react"
import { useFactoryStore } from "@/store/factoryStore"
import type { WSMessage, RobotState } from "@/lib/types"
import type { RobotPositionRef, MachineGroupRef } from "@/hooks/useThreeScene"
import { applyComponentFault } from "@/lib/threeHelpers"

export function useWebSocket(
  url: string,
  robotPosRef?: React.MutableRefObject<RobotPositionRef>,
  machineGroupsRef?: React.MutableRefObject<MachineGroupRef>,
  updatePathLine?: (robotId: string, path: [number, number][]) => void,
  clearPathLine?: (robotId: string) => void,
  updateComponentFault?: (machineId: string, faults: Record<string, { severity: "warn" | "critical" }>) => void,
) {
  const queueRef = useRef<WSMessage[]>([])
  const rafRef = useRef<number>(0)
  const wsRef = useRef<WebSocket | null>(null)
  const prevSelectedRef = useRef<string | null>(null)

  useEffect(() => {
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onmessage = (e) => {
      try { queueRef.current.push(JSON.parse(e.data) as WSMessage) } catch {}
    }

    const drain = () => {
      const store = useFactoryStore.getState()

      // 선택 변경 감지 → subscribe/unsubscribe 전송
      const currentSelected = store.selectedEntityId
      if (currentSelected !== prevSelectedRef.current) {
        if (prevSelectedRef.current && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "unsubscribe_detail", payload: { entityId: prevSelectedRef.current } }))
          if (prevSelectedRef.current.startsWith("R")) clearPathLine?.(prevSelectedRef.current)
        }
        if (currentSelected && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "subscribe_detail", payload: { entityId: currentSelected } }))
        }
        prevSelectedRef.current = currentSelected
      }

      // 메시지 큐 드레인
      const batch = queueRef.current.splice(0)
      for (const msg of batch) {
        if (msg.type === "sensor_update") {
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
        } else if (msg.type === "machine_detail") {
          store.setMachineDetail(msg.payload)
        } else if (msg.type === "robot_path") {
          store.setRobotPath(msg.payload)
          updatePathLine?.(msg.payload.robotId, msg.payload.recommendedPath)
        } else if (msg.type === "component_fault") {
          store.setComponentFault(msg.payload)
          updateComponentFault?.(msg.payload.machineId, msg.payload.faultedParts)
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

- [ ] **Step 2: 커밋**

```bash
git add frontend/hooks/useWebSocket.ts
git commit -m "feat: useWebSocket handles detail messages and auto subscribe/unsubscribe on selection"
```

---

## Phase 4: UI 컴포넌트

### Task 8: Palette 컴포넌트

**Files:**
- Create: `frontend/components/Palette.tsx`

- [ ] **Step 1: `components/Palette.tsx` 작성**

```typescript
"use client"
import { useFactoryStore } from "@/store/factoryStore"
import type { EntityType } from "@/lib/types"

const POOL_MACHINES = [
  { poolId: "M1", type: "press" as EntityType, label: "프레스" },
  { poolId: "M2", type: "cnc" as EntityType, label: "CNC" },
  { poolId: "M3", type: "cnc" as EntityType, label: "CNC #2" },
  { poolId: "M4", type: "conveyor" as EntityType, label: "컨베이어" },
  { poolId: "M5", type: "press" as EntityType, label: "프레스 #2" },
]
const POOL_ROBOTS = [
  { poolId: "R1", type: "robot" as EntityType, label: "AMR #1" },
  { poolId: "R2", type: "robot" as EntityType, label: "AMR #2" },
  { poolId: "R3", type: "robot" as EntityType, label: "AMR #3" },
]

const TYPE_ICON: Record<string, string> = {
  press: "⬛", cnc: "⚙", conveyor: "▬", robot: "◎",
}

export function Palette() {
  const placedEntities = useFactoryStore((s) => s.placedEntities)
  const placementMode = useFactoryStore((s) => s.placementMode)
  const enterPlacementMode = useFactoryStore((s) => s.enterPlacementMode)
  const exitPlacementMode = useFactoryStore((s) => s.exitPlacementMode)
  const removeEntity = useFactoryStore((s) => s.removeEntity)

  const isPlaced = (poolId: string) => placedEntities.some((e) => e.id === poolId)

  const handleItemClick = (poolId: string, type: EntityType) => {
    if (isPlaced(poolId)) return
    if (placementMode?.poolId === poolId) { exitPlacementMode(); return }
    enterPlacementMode(type, poolId)
  }

  return (
    <div className="bg-gray-900 rounded-xl p-3 w-44 space-y-3 select-none">
      {placementMode && (
        <div className="text-xs text-yellow-400 bg-yellow-900/30 rounded px-2 py-1">
          바닥을 클릭하여 배치
        </div>
      )}

      <section>
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">기계</p>
        <div className="space-y-1">
          {POOL_MACHINES.map(({ poolId, type, label }) => {
            const placed = isPlaced(poolId)
            const active = placementMode?.poolId === poolId
            return (
              <button
                key={poolId}
                onClick={() => handleItemClick(poolId, type)}
                disabled={placed}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors
                  ${placed ? "opacity-30 cursor-not-allowed text-gray-500"
                    : active ? "bg-yellow-600 text-white"
                    : "hover:bg-gray-700 text-gray-200"}`}
              >
                <span>{TYPE_ICON[type]}</span>
                <span>{label}</span>
                {placed && (
                  <button
                    onClick={(e) => { e.stopPropagation(); removeEntity(poolId) }}
                    className="ml-auto text-gray-500 hover:text-red-400 text-xs"
                  >✕</button>
                )}
              </button>
            )
          })}
        </div>
      </section>

      <section>
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">로봇</p>
        <div className="space-y-1">
          {POOL_ROBOTS.map(({ poolId, type, label }) => {
            const placed = isPlaced(poolId)
            const active = placementMode?.poolId === poolId
            return (
              <button
                key={poolId}
                onClick={() => handleItemClick(poolId, type)}
                disabled={placed}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors
                  ${placed ? "opacity-30 cursor-not-allowed text-gray-500"
                    : active ? "bg-yellow-600 text-white"
                    : "hover:bg-gray-700 text-gray-200"}`}
              >
                <span>{TYPE_ICON[type]}</span>
                <span>{label}</span>
                {placed && (
                  <button
                    onClick={(e) => { e.stopPropagation(); removeEntity(poolId) }}
                    className="ml-auto text-gray-500 hover:text-red-400 text-xs"
                  >✕</button>
                )}
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}
```

- [ ] **Step 2: 커밋**

```bash
git add frontend/components/Palette.tsx
git commit -m "feat: Palette sidebar with click-to-place and remove"
```

---

### Task 9: MachineDetailPanel + RobotDetailPanel

**Files:**
- Create: `frontend/components/MachineDetailPanel.tsx`
- Create: `frontend/components/RobotDetailPanel.tsx`

- [ ] **Step 1: `components/MachineDetailPanel.tsx` 작성**

```typescript
"use client"
import { useEffect, useRef } from "react"
import * as echarts from "echarts"
import { useFactoryStore } from "@/store/factoryStore"

const STATUS_COLOR = { ok: "#10b981", warn: "#f59e0b", critical: "#ef4444" }
const PART_LABELS: Record<string, string> = {
  body: "메인 하우징", motor: "구동부", actuator: "작동부", sensor_unit: "센서",
}

function WearBars({ components }: { components: Record<string, { wear: number; status: string }> }) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (!ref.current) return
    chartRef.current = echarts.init(ref.current, "dark")
    return () => chartRef.current?.dispose()
  }, [])

  useEffect(() => {
    if (!chartRef.current) return
    const parts = Object.entries(components)
    chartRef.current.setOption({
      backgroundColor: "transparent",
      animation: false,
      grid: { left: 80, right: 40, top: 10, bottom: 10 },
      xAxis: { type: "value", max: 100, splitLine: { lineStyle: { color: "#374151" } } },
      yAxis: { type: "category", data: parts.map(([p]) => PART_LABELS[p] ?? p),
               axisLabel: { color: "#9ca3af", fontSize: 11 } },
      series: [{
        type: "bar",
        data: parts.map(([, v]) => ({
          value: v.wear,
          itemStyle: { color: STATUS_COLOR[v.status as keyof typeof STATUS_COLOR] ?? "#6b7280" },
        })),
        label: { show: true, position: "right", formatter: "{c}%", color: "#d1d5db", fontSize: 10 },
      }],
    }, { notMerge: true })
  }, [components])

  return <div ref={ref} style={{ width: "100%", height: 120 }} />
}

function ThermalHeatmap({ grid }: { grid: number[][] }) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (!ref.current) return
    chartRef.current = echarts.init(ref.current, "dark")
    return () => chartRef.current?.dispose()
  }, [])

  useEffect(() => {
    if (!chartRef.current || !grid.length) return
    const data: [number, number, number][] = []
    grid.forEach((row, r) => row.forEach((val, c) => data.push([c, r, val])))

    chartRef.current.setOption({
      backgroundColor: "transparent",
      animation: false,
      grid: { left: 10, right: 60, top: 10, bottom: 10 },
      xAxis: { type: "category", data: ["0","1","2","3"], splitArea: { show: true } },
      yAxis: { type: "category", data: ["0","1","2","3"], splitArea: { show: true } },
      visualMap: {
        min: 0, max: 1, calculable: true, orient: "vertical", right: 0,
        inRange: { color: ["#1e3a5f", "#f59e0b", "#ef4444"] },
      },
      series: [{ type: "heatmap", data, label: { show: false } }],
    }, { notMerge: true })
  }, [grid])

  return <div ref={ref} style={{ width: "100%", height: 130 }} />
}

export function MachineDetailPanel({ machineId }: { machineId: string }) {
  const detail = useFactoryStore((s) => s.machineDetails[machineId])
  const fault = useFactoryStore((s) => s.componentFaults[machineId])

  if (!detail) {
    return (
      <div className="bg-gray-900 rounded-xl p-4 w-64 text-gray-500 text-sm animate-pulse">
        데이터 로딩 중...
      </div>
    )
  }

  const criticalParts = fault
    ? Object.entries(fault.faultedParts).filter(([, v]) => v.severity === "critical")
    : []

  return (
    <div className="bg-gray-900 rounded-xl p-4 w-64 space-y-3">
      <div>
        <p className="font-semibold text-gray-100">{machineId}</p>
        <p className="text-xs text-gray-400 flex items-center gap-2 mt-0.5">
          <span className={`w-2 h-2 rounded-full inline-block ${detail.operationRate > 50 ? "bg-green-400" : "bg-red-400"}`} />
          가동률 {detail.operationRate.toFixed(1)}%
        </p>
      </div>

      {criticalParts.length > 0 && (
        <div className="bg-red-900/40 border border-red-700 rounded p-2">
          <p className="text-xs text-red-300 font-medium">고장 감지</p>
          {criticalParts.map(([part, v]) => (
            <p key={part} className="text-xs text-red-400">{PART_LABELS[part] ?? part}: {v.description}</p>
          ))}
        </div>
      )}

      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">부품 노후도</p>
        <WearBars components={detail.components} />
      </div>

      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">열분포 히트맵</p>
        <ThermalHeatmap grid={detail.thermalGrid} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: `components/RobotDetailPanel.tsx` 작성**

```typescript
"use client"
import { useFactoryStore } from "@/store/factoryStore"

const PATH_TYPE_LABEL: Record<string, string> = {
  idle_patrol: "순찰 중",
  dispatch: "파견 중",
  returning: "복귀 중",
}
const PATH_TYPE_COLOR: Record<string, string> = {
  idle_patrol: "text-green-400",
  dispatch: "text-yellow-400",
  returning: "text-blue-400",
}

export function RobotDetailPanel({ robotId }: { robotId: string }) {
  const path = useFactoryStore((s) => s.robotPaths[robotId])
  const dispatch = useFactoryStore((s) => s.dispatchCommand)
  const isDispatched = dispatch?.robotId === robotId

  return (
    <div className="bg-gray-900 rounded-xl p-4 w-64 space-y-3">
      <div>
        <p className="font-semibold text-gray-100">{robotId}</p>
        <p className={`text-xs mt-0.5 ${isDispatched ? "text-yellow-400" : "text-green-400"}`}>
          {isDispatched ? "⚡ 파견 중" : "● 대기 중"}
        </p>
      </div>

      {path && (
        <>
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">상태</span>
              <span className={PATH_TYPE_COLOR[path.pathType] ?? "text-gray-300"}>
                {PATH_TYPE_LABEL[path.pathType] ?? path.pathType}
              </span>
            </div>
            {path.targetEntityId && (
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">목적지</span>
                <span className="text-gray-300">{path.targetEntityId}</span>
              </div>
            )}
            {path.eta > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">ETA</span>
                <span className="text-gray-300">{path.eta.toFixed(0)}초</span>
              </div>
            )}
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">현재 위치</span>
              <span className="text-gray-300 font-mono">
                ({path.currentPos[0].toFixed(1)}, {path.currentPos[1].toFixed(1)})
              </span>
            </div>
          </div>

          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">추천 경로</p>
            <div className="bg-gray-800 rounded p-2 space-y-0.5 max-h-28 overflow-y-auto">
              {path.recommendedPath.map(([x, z], i) => (
                <p key={i} className="text-xs font-mono text-gray-400">
                  {i === 0 ? "▶ " : `${i}. `}({x.toFixed(1)}, {z.toFixed(1)})
                </p>
              ))}
            </div>
          </div>
        </>
      )}

      {!path && (
        <p className="text-xs text-gray-500 animate-pulse">경로 데이터 로딩 중...</p>
      )}
    </div>
  )
}
```

- [ ] **Step 3: 커밋**

```bash
git add frontend/components/MachineDetailPanel.tsx frontend/components/RobotDetailPanel.tsx
git commit -m "feat: MachineDetailPanel (wear bars + thermal heatmap) and RobotDetailPanel"
```

---

### Task 10: page.tsx — 전체 레이아웃 통합

**Files:**
- Modify: `frontend/app/page.tsx`

- [ ] **Step 1: `page.tsx` 전체 업데이트**

```typescript
"use client"
import { useRef } from "react"
import { useWebSocket } from "@/hooks/useWebSocket"
import { useThreeScene } from "@/hooks/useThreeScene"
import { FactoryCanvas } from "@/components/FactoryCanvas"
import { SensorChart } from "@/components/SensorChart"
import { AgentPanel } from "@/components/AgentPanel"
import { AlertBanner } from "@/components/AlertBanner"
import { Palette } from "@/components/Palette"
import { MachineDetailPanel } from "@/components/MachineDetailPanel"
import { RobotDetailPanel } from "@/components/RobotDetailPanel"
import { useFactoryStore } from "@/store/factoryStore"

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000/ws"

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { robotPosRef, machineGroupsRef, updatePathLine, clearPathLine, updateComponentFault } = useThreeScene(canvasRef)
  useWebSocket(WS_URL, robotPosRef, machineGroupsRef, updatePathLine, clearPathLine, updateComponentFault)

  const selectedId = useFactoryStore((s) => s.selectedEntityId)
  const placedEntities = useFactoryStore((s) => s.placedEntities)
  const placedMachineIds = placedEntities.filter((e) => e.type !== "robot").map((e) => e.id)

  const isMachineSelected = selectedId?.startsWith("M") ?? false
  const isRobotSelected = selectedId?.startsWith("R") ?? false

  return (
    <main className="bg-gray-950 text-white min-h-screen p-4">
      <h1 className="text-xl font-bold mb-3">SDF 디지털 트윈</h1>
      <AlertBanner />

      <div className="flex gap-3 mt-3">
        {/* 팔레트 */}
        <Palette />

        {/* 3D 캔버스 */}
        <div className="flex-1 space-y-3">
          <FactoryCanvas canvasRef={canvasRef} />

          {/* 배치된 기계의 센서 차트 */}
          {placedMachineIds.length > 0 && (
            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${placedMachineIds.length}, 1fr)` }}>
              {placedMachineIds.map((id) => <SensorChart key={id} machineId={id} />)}
            </div>
          )}
        </div>

        {/* 우측 패널 */}
        <div className="space-y-3 w-64">
          {isMachineSelected && selectedId && (
            <MachineDetailPanel machineId={selectedId} />
          )}
          {isRobotSelected && selectedId && (
            <RobotDetailPanel robotId={selectedId} />
          )}
          <AgentPanel />
        </div>
      </div>
    </main>
  )
}
```

- [ ] **Step 2: 엔드 투 엔드 시각 검증**

백엔드 + 프론트엔드 동시 실행:
```bash
# 터미널 1
cd backend && uvicorn main:app --reload --port 8000

# 터미널 2
cd frontend && npm run dev
```

체크리스트:
- [ ] 팔레트에서 "CNC" 클릭 → 커서 변경, 고스트 메시 표시
- [ ] 바닥 클릭 → 서브메시 구조의 CNC 기계 배치
- [ ] 기계 클릭 → 노란색 outline + 우측 MachineDetailPanel 표시
- [ ] 노후도 바 차트 및 열분포 히트맵 렌더링
- [ ] "AMR #1" 배치 후 클릭 → RobotDetailPanel + 점선 경로 라인 표시
- [ ] 60~120초 후 고장 발생 → 해당 기계의 특정 서브메시 빨간색 변경

- [ ] **Step 3: 커밋**

```bash
git add frontend/app/page.tsx
git commit -m "feat: full layout integration — palette, detail panels, dynamic sensor charts"
```

---

## 전체 테스트 실행

```bash
# 백엔드
cd backend && pytest tests/ -v

# 프론트엔드
cd frontend && npx vitest run
```

모든 테스트 통과 확인 후 최종 커밋:

```bash
git add .
git commit -m "feat: dynamic canvas MVP complete — placement, selection, sub-mesh fault visualization"
```
