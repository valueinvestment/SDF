# UI Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OrbitControls zoom/rotate to 3D canvas, move detail panels below canvas, pre-place all entities by default, enable palette re-placement, and animate robots along waypoints — all with responsive sizing.

**Architecture:** Changes are isolated across store (default state + moveEntity), useThreeScene hook (OrbitControls + waypoint animation + resize observer), useWebSocket hook (wire up updateRobotPath), Palette component (re-place UX), detail panel components (remove fixed width), and page layout (responsive stacked layout). Each task is independently testable.

**Tech Stack:** Next.js 14, React 18, Three.js 0.184.0, OrbitControls (`three/examples/jsm/controls/OrbitControls.js`), Zustand, ECharts, Tailwind CSS

---

## File Map

| File | Change |
|------|--------|
| `store/factoryStore.ts` | Add default `placedEntities` with all 5 machines + 3 robots; add `moveEntity` action |
| `hooks/useThreeScene.ts` | OrbitControls, click-vs-drag disambiguation, ResizeObserver, robot waypoint animation, expose `updateRobotPath` |
| `hooks/useWebSocket.ts` | Accept `updateRobotPath` prop; call it when `robot_path` message arrives |
| `components/Palette.tsx` | Placed items: click triggers `moveEntity` (remove + re-enter placement mode) |
| `components/MachineDetailPanel.tsx` | Remove hardcoded `w-64`; panels are full-width in their container |
| `components/RobotDetailPanel.tsx` | Remove hardcoded `w-64` |
| `app/page.tsx` | New responsive layout: top row (Palette + Canvas + AgentPanel), bottom row (detail + charts) |

---

## Task 1: Default entity placement in store

**Files:**
- Modify: `store/factoryStore.ts`

- [ ] **Step 1: Add `moveEntity` action and default `placedEntities` to store**

Replace the `placedEntities: []` initial value and add `moveEntity` in `store/factoryStore.ts`:

```typescript
// At the top of the interface, add:
moveEntity: (poolId: string) => void

// Replace placedEntities initial value:
placedEntities: [
  { id: "M1", type: "press",    x: 3,  z: 3,  label: "M1" },
  { id: "M2", type: "cnc",      x: 7,  z: 3,  label: "M2" },
  { id: "M3", type: "cnc",      x: 12, z: 3,  label: "M3" },
  { id: "M4", type: "conveyor", x: 3,  z: 12, label: "M4" },
  { id: "M5", type: "press",    x: 12, z: 12, label: "M5" },
  { id: "R1", type: "robot",    x: 10, z: 10, label: "R1" },
  { id: "R2", type: "robot",    x: 5,  z: 5,  label: "R2" },
  { id: "R3", type: "robot",    x: 15, z: 5,  label: "R3" },
] as PlacedEntity[],

// Add alongside removeEntity:
moveEntity: (poolId) =>
  set((state) => {
    const entity = state.placedEntities.find((e) => e.id === poolId)
    if (!entity) return {}
    return {
      placedEntities: state.placedEntities.filter((e) => e.id !== poolId),
      placementMode: { type: entity.type, poolId },
    }
  }),
```

- [ ] **Step 2: Verify types still compile**

```bash
cd frontend && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add frontend/store/factoryStore.ts
git commit -m "feat: default entity placement + moveEntity action"
```

---

## Task 2: Palette re-placement UX

**Files:**
- Modify: `components/Palette.tsx`

- [ ] **Step 1: Update `handleItemClick` and item rendering in `Palette.tsx`**

```typescript
// Replace the import line to add moveEntity:
const moveEntity = useFactoryStore((s) => s.moveEntity)

// Replace handleItemClick:
const handleItemClick = (poolId: string, type: EntityType) => {
  if (placementMode?.poolId === poolId) { exitPlacementMode(); return }
  if (isPlaced(poolId)) { moveEntity(poolId); return }
  enterPlacementMode(type, poolId)
}

// In renderItem, replace the placed className and add move hint:
const placed = isPlaced(poolId)
const active = placementMode?.poolId === poolId
const isMoving = !placed && placementMode?.poolId === poolId  // moving = removed, in placementMode

return (
  <div
    key={poolId}
    className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors cursor-pointer
      ${active ? "bg-yellow-600 text-white"
        : placed ? "bg-gray-800 text-gray-300 hover:bg-gray-700"
        : "hover:bg-gray-700 text-gray-200"}`}
    onClick={() => handleItemClick(poolId, type)}
  >
    <span>{TYPE_ICON[type]}</span>
    <span className="flex-1">{label}</span>
    {placed && (
      <span className="text-xs text-gray-500 hover:text-yellow-400" title="클릭하여 이동">↑</span>
    )}
    {placed && (
      <button
        onClick={(e) => { e.stopPropagation(); removeEntity(poolId) }}
        className="text-gray-500 hover:text-red-400 text-xs ml-1"
      >✕</button>
    )}
  </div>
)
```

- [ ] **Step 2: Verify compile**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add frontend/components/Palette.tsx
git commit -m "feat: palette click on placed entity enters move mode"
```

---

## Task 3: OrbitControls + click disambiguation + ResizeObserver

**Files:**
- Modify: `hooks/useThreeScene.ts`

This is the largest change. We replace the raw `click` listener with a mousedown/mouseup distance check, add OrbitControls, and add a ResizeObserver so the canvas and camera update when the container resizes.

- [ ] **Step 1: Add OrbitControls import and update `useThreeScene.ts`**

Replace the entire `useThreeScene.ts` with the following. Key changes are marked with `// NEW`:

```typescript
"use client"
import { useEffect, useRef } from "react"
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js" // NEW
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

// NEW: waypoint queue per robot
interface RobotWaypoints {
  waypoints: [number, number][]
  index: number
}

export function useThreeScene(canvasRef: React.RefObject<HTMLCanvasElement>) {
  const robotPosRef = useRef<RobotPositionRef>({})
  const machineGroupsRef = useRef<MachineGroupRef>({})
  const robotMeshesRef = useRef<RobotMeshRef>({})
  const pathLinesRef = useRef<Record<string, THREE.Line>>({})
  const ghostRef = useRef<THREE.Group | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const robotWaypointsRef = useRef<Record<string, RobotWaypoints>>({}) // NEW

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

    // NEW: OrbitControls
    const controls = new OrbitControls(camera, canvas)
    controls.enableDamping = true
    controls.dampingFactor = 0.1
    controls.target.set(10, 0, 10)
    controls.update()

    scene.add(new THREE.AmbientLight(0xffffff, 0.6))
    const dir = new THREE.DirectionalLight(0xffffff, 0.8)
    dir.position.set(10, 20, 10)
    scene.add(dir)

    const grid = new THREE.GridHelper(22, 22, 0x374151, 0x1f2937)
    grid.position.set(10, 0, 10)
    scene.add(grid)

    const floorGeo = new THREE.PlaneGeometry(22, 22)
    const floorMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
    const floor = new THREE.Mesh(floorGeo, floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.position.set(10, 0, 10)
    floor.name = "__floor__"
    scene.add(floor)

    const raycaster = new THREE.Raycaster()

    // NEW: ResizeObserver — keeps canvas crisp when container resizes
    const resizeObserver = new ResizeObserver(() => {
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    })
    resizeObserver.observe(canvas)

    // NEW: click disambiguation — only fire click if mouse didn't move
    let mouseDownPos = { x: 0, y: 0 }
    const onMouseDown = (e: MouseEvent) => { mouseDownPos = { x: e.clientX, y: e.clientY } }

    const onMouseMove = (e: MouseEvent) => {
      const store = useFactoryStore.getState()
      if (!store.placementMode) {
        if (ghostRef.current) { scene.remove(ghostRef.current); ghostRef.current = null }
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
      if (!ghostRef.current) {
        const type = store.placementMode.type
        const ghost = type === "robot"
          ? new THREE.Group()
          : buildMachineGroup("ghost", type as MachineType)
        ghost.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            const mat = (obj.material as THREE.MeshStandardMaterial).clone()
            mat.opacity = 0.4; mat.transparent = true; obj.material = mat
          }
        })
        ghostRef.current = ghost
        scene.add(ghost)
      }
      ghostRef.current.position.set(x, 0, z)
      const tooClose = store.placedEntities.some((e) => {
        const dx = e.x - x, dz = e.z - z
        return Math.sqrt(dx * dx + dz * dz) < 1.5
      })
      ghostRef.current.traverse((obj) => {
        if (obj instanceof THREE.Mesh)
          (obj.material as THREE.MeshStandardMaterial).color.setHex(tooClose ? 0xef4444 : 0x3b82f6)
      })
    }

    const onMouseUp = (e: MouseEvent) => {
      // NEW: only treat as click if mouse barely moved
      const dx = e.clientX - mouseDownPos.x
      const dy = e.clientY - mouseDownPos.y
      if (Math.sqrt(dx * dx + dy * dy) > 5) return

      const store = useFactoryStore.getState()
      const rect = canvas.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(ndc, camera)

      if (store.placementMode) {
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

      const allMeshes: THREE.Object3D[] = [
        ...Object.values(machineGroupsRef.current),
        ...Object.values(robotMeshesRef.current),
      ]
      const hits = raycaster.intersectObjects(allMeshes, true)
      const prev = store.selectedEntityId
      if (prev) {
        const prevObj = machineGroupsRef.current[prev] ?? robotMeshesRef.current[prev]
        if (prevObj) removeSelectionOutline(prevObj)
      }
      if (!hits.length) { store.selectEntity(null); return }
      let obj: THREE.Object3D | null = hits[0].object
      while (obj && !obj.userData.entityId) obj = obj.parent ?? null
      if (!obj?.userData.entityId) return
      store.selectEntity(obj.userData.entityId as string)
      addSelectionOutline(obj)
    }

    canvas.addEventListener("mousedown", onMouseDown)
    canvas.addEventListener("mousemove", onMouseMove)
    canvas.addEventListener("mouseup", onMouseUp)

    let rafId: number
    const animate = () => {
      rafId = requestAnimationFrame(animate)
      controls.update() // NEW: required for damping

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
          const mesh = robotMeshesRef.current[entity.id]
          if (!mesh) continue

          // NEW: waypoint-based movement
          const wp = robotWaypointsRef.current[entity.id]
          if (wp && wp.index < wp.waypoints.length) {
            const [tx, tz] = wp.waypoints[wp.index]
            const dx = tx - mesh.position.x
            const dz = tz - mesh.position.z
            const dist = Math.sqrt(dx * dx + dz * dz)
            if (dist < 0.15) {
              wp.index++
            } else {
              mesh.position.x += dx * 0.06
              mesh.position.z += dz * 0.06
            }
          } else {
            // fallback: lerp toward sensor position
            const target = robotPosRef.current[entity.id]
            if (target) {
              mesh.position.x += (target.x - mesh.position.x) * 0.08
              mesh.position.z += (target.y - mesh.position.z) * 0.08
            }
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
      resizeObserver.disconnect() // NEW
      canvas.removeEventListener("mousedown", onMouseDown)
      canvas.removeEventListener("mousemove", onMouseMove)
      canvas.removeEventListener("mouseup", onMouseUp)
      controls.dispose() // NEW
      disposeScene(scene, renderer)
    }
  }, [canvasRef])

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

  // NEW: set waypoints for a robot so animate loop drives movement
  const updateRobotPath = (robotId: string, waypoints: [number, number][]) => {
    robotWaypointsRef.current[robotId] = { waypoints, index: 0 }
  }

  const updateComponentFault = (machineId: string, faultedParts: Record<string, { severity: "warn" | "critical" }>) => {
    const group = machineGroupsRef.current[machineId]
    if (group) applyComponentFault(group, faultedParts)
  }

  return { robotPosRef, machineGroupsRef, updatePathLine, clearPathLine, updateRobotPath, updateComponentFault }
}
```

- [ ] **Step 2: Verify compile**

```bash
cd frontend && npx tsc --noEmit
```
Expected: no errors. If `three/examples/jsm` types are missing, add `@types/three` — but Three.js 0.184 ships its own types so this should be fine.

- [ ] **Step 3: Commit**

```bash
git add frontend/hooks/useThreeScene.ts
git commit -m "feat: OrbitControls, click disambiguation, ResizeObserver, robot waypoints"
```

---

## Task 4: Wire updateRobotPath into useWebSocket

**Files:**
- Modify: `hooks/useWebSocket.ts`

- [ ] **Step 1: Add `updateRobotPath` parameter and call it on `robot_path` message**

```typescript
export function useWebSocket(
  url: string,
  robotPosRef?: React.MutableRefObject<RobotPositionRef>,
  machineGroupsRef?: React.MutableRefObject<MachineGroupRef>,
  updatePathLine?: (robotId: string, path: [number, number][]) => void,
  clearPathLine?: (robotId: string) => void,
  updateComponentFault?: (machineId: string, faults: Record<string, { severity: "warn" | "critical" }>) => void,
  updateRobotPath?: (robotId: string, waypoints: [number, number][]) => void, // NEW
) {
```

In the `drain` function, update the `robot_path` handler:

```typescript
} else if (msg.type === "robot_path") {
  store.setRobotPath(msg.payload)
  updatePathLine?.(msg.payload.robotId, msg.payload.recommendedPath)
  updateRobotPath?.(msg.payload.robotId, msg.payload.recommendedPath) // NEW
```

- [ ] **Step 2: Update the call site in `app/page.tsx`**

In `page.tsx`, pass `updateRobotPath` as the 7th argument to `useWebSocket`:

```typescript
const { robotPosRef, machineGroupsRef, updatePathLine, clearPathLine, updateRobotPath, updateComponentFault } = useThreeScene(canvasRef)
useWebSocket(WS_URL, robotPosRef, machineGroupsRef, updatePathLine, clearPathLine, updateComponentFault, updateRobotPath)
```

- [ ] **Step 3: Verify compile**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/hooks/useWebSocket.ts frontend/app/page.tsx
git commit -m "feat: wire robot waypoint animation from robot_path WS message"
```

---

## Task 5: Remove fixed widths from detail panels

**Files:**
- Modify: `components/MachineDetailPanel.tsx`
- Modify: `components/RobotDetailPanel.tsx`

- [ ] **Step 1: Remove `w-64` from MachineDetailPanel**

In `MachineDetailPanel.tsx`, change:
```typescript
// BEFORE
<div className="bg-gray-900 rounded-xl p-4 w-64 space-y-3">

// AFTER
<div className="bg-gray-900 rounded-xl p-4 w-full space-y-3">
```

Also the loading state:
```typescript
// BEFORE
<div className="bg-gray-900 rounded-xl p-4 w-64 text-gray-500 text-sm animate-pulse">

// AFTER
<div className="bg-gray-900 rounded-xl p-4 w-full text-gray-500 text-sm animate-pulse">
```

- [ ] **Step 2: Remove `w-64` from RobotDetailPanel**

In `RobotDetailPanel.tsx`, change:
```typescript
// BEFORE
<div className="bg-gray-900 rounded-xl p-4 w-64 space-y-3">

// AFTER
<div className="bg-gray-900 rounded-xl p-4 w-full space-y-3">
```

- [ ] **Step 3: Commit**

```bash
git add frontend/components/MachineDetailPanel.tsx frontend/components/RobotDetailPanel.tsx
git commit -m "refactor: remove fixed w-64 from detail panels"
```

---

## Task 6: Responsive page layout

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Rewrite page layout**

Replace the entire content of `app/page.tsx`:

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
  const {
    robotPosRef, machineGroupsRef,
    updatePathLine, clearPathLine,
    updateRobotPath, updateComponentFault,
  } = useThreeScene(canvasRef)
  useWebSocket(WS_URL, robotPosRef, machineGroupsRef, updatePathLine, clearPathLine, updateComponentFault, updateRobotPath)

  const selectedId = useFactoryStore((s) => s.selectedEntityId)
  const placedEntities = useFactoryStore((s) => s.placedEntities)
  const placedMachineIds = placedEntities.filter((e) => e.type !== "robot").map((e) => e.id)

  const isMachineSelected = selectedId?.startsWith("M") ?? false
  const isRobotSelected = selectedId?.startsWith("R") ?? false

  return (
    <main className="bg-gray-950 text-white min-h-screen p-3 md:p-4 space-y-3">
      <h1 className="text-xl font-bold">SDF 디지털 트윈</h1>
      <AlertBanner />

      {/* Top row: Palette | 3D Canvas | AgentPanel */}
      <div className="flex gap-3 items-start">
        <Palette />

        <div className="flex-1 min-w-0">
          <FactoryCanvas canvasRef={canvasRef} />
        </div>

        <div className="w-56 xl:w-64 flex-shrink-0">
          <AgentPanel />
        </div>
      </div>

      {/* Bottom row: detail panel + sensor charts */}
      {(isMachineSelected || isRobotSelected || placedMachineIds.length > 0) && (
        <div className="flex gap-3 items-start">
          {/* Detail panel: shows when entity selected */}
          {(isMachineSelected || isRobotSelected) && selectedId && (
            <div className="w-72 flex-shrink-0">
              {isMachineSelected && <MachineDetailPanel machineId={selectedId} />}
              {isRobotSelected && <RobotDetailPanel robotId={selectedId} />}
            </div>
          )}

          {/* Sensor charts: one per placed machine */}
          {placedMachineIds.length > 0 && (
            <div
              className="flex-1 min-w-0 grid gap-2"
              style={{
                gridTemplateColumns: `repeat(${Math.min(placedMachineIds.length, 5)}, minmax(0, 1fr))`,
              }}
            >
              {placedMachineIds.map((id) => <SensorChart key={id} machineId={id} />)}
            </div>
          )}
        </div>
      )}
    </main>
  )
}
```

- [ ] **Step 2: Make FactoryCanvas height responsive**

In `components/FactoryCanvas.tsx`, make the height responsive using CSS clamp:

```typescript
export function FactoryCanvas({ canvasRef }: Props) {
  return (
    <canvas
      ref={canvasRef}
      className="w-full rounded-lg block"
      style={{ height: "clamp(380px, 55vh, 700px)" }}
    />
  )
}
```

- [ ] **Step 3: Verify compile**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/app/page.tsx frontend/components/FactoryCanvas.tsx
git commit -m "feat: responsive layout — detail panels and charts below 3D canvas"
```

---

## Self-Review

**Spec coverage check:**
1. ✅ Machine/robot detail below canvas → Task 6
2. ✅ 3D zoom/rotate/pan → Task 3 (OrbitControls)
3. ✅ Re-place on palette click → Task 2 (moveEntity) + Task 1 (store action)
4. ✅ Default pre-placement → Task 1 (default placedEntities)
5. ✅ Robot path animation → Task 3 (waypoints) + Task 4 (wire up)
6. ✅ Responsive sizing → Task 6 (clamp height, flex layout) + Task 3 (ResizeObserver)

**Placeholder scan:** None found.

**Type consistency:**
- `updateRobotPath` defined in Task 3, consumed in Task 4 ✅
- `moveEntity` defined in Task 1, used in Task 2 ✅
- `RobotWaypoints` internal to `useThreeScene`, not exported ✅
- `updateRobotPath` added as 7th param in both `useWebSocket` signature (Task 4) and call site (Task 4 Step 2) ✅
