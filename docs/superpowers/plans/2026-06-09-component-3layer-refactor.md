# Component 3-Layer Refactoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `Palette`, `RobotDetailPanel`, `SensorChart`, and `MachineDetailPanel` into a 3-layer architecture (Logic Hook → View Assembly → Imperative Control) per `docs/Skill.md`.

**Architecture:** Layer 1 (Logic) — pure data hooks with no JSX or ECharts knowledge. Layer 2 (View Assembly) — components that map hook data to ECharts option objects and compose sub-components. Layer 3 (Imperative Control) — single `BaseECharts` wrapper that exclusively owns `echarts.init`, `ResizeObserver`, `dispose`, and `setOption`. All ECharts DOM manipulation is isolated to this one file.

**Tech Stack:** Next.js 14, TypeScript, Zustand, ECharts, @headlessui/react, Tailwind CSS

---

## File Map

| Action | File | Layer | Responsibility |
|---|---|---|---|
| Create | `frontend/components/BaseECharts.tsx` | 3 — Imperative | `echarts.init`, ResizeObserver, dispose, setOption |
| Create | `frontend/hooks/useSensorChart.ts` | 1 — Logic | `history` from store |
| Modify | `frontend/components/SensorChart.tsx` | 2 — View Assembly | maps history → ECharts option, uses BaseECharts |
| Create | `frontend/hooks/useMachineDetail.ts` | 1 — Logic | `detail` + `criticalParts` from store |
| Modify | `frontend/components/MachineDetailPanel.tsx` | 2 — View Assembly | WearBars + ThermalHeatmap each use BaseECharts |
| Create | `frontend/hooks/usePalette.ts` | 1 — Logic | entities, selection, placement handlers |
| Modify | `frontend/components/Palette.tsx` | 2 — View Assembly | renders using usePalette |
| Create | `frontend/hooks/useRobotDetail.ts` | 1 — Logic | `path` + `isDispatched` from store |
| Modify | `frontend/components/RobotDetailPanel.tsx` | 2 — View Assembly | renders using useRobotDetail |
| Modify | `docs/Skill.md` | — | update status table |

---

## Task 1: Create `BaseECharts` — Layer 3 (Imperative Control)

**Files:**
- Create: `frontend/components/BaseECharts.tsx`

This is the ONLY file in the codebase allowed to call `echarts.init`, use `ResizeObserver` for chart resizing, and call `dispose`. It receives an `option` prop and calls `chartInstance.setOption(option)` whenever it changes. It knows nothing about what the data means.

- [ ] **Step 1: Create the file**

`frontend/components/BaseECharts.tsx`:

```tsx
"use client"
import { useEffect, useRef } from "react"
import type { CSSProperties } from "react"
import * as echarts from "echarts"

interface BaseEChartsProps {
  option: echarts.EChartsOption | null
  style?: CSSProperties
  notMerge?: boolean
}

export function BaseECharts({
  option,
  style = { width: "100%", height: 120 },
  notMerge = true,
}: BaseEChartsProps) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    chartRef.current = echarts.init(el, "dark")
    const ro = new ResizeObserver(() => chartRef.current?.resize())
    ro.observe(el)
    return () => {
      ro.disconnect()
      chartRef.current?.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!chartRef.current || !option) return
    chartRef.current.setOption(option, { notMerge })
  }, [option, notMerge])

  return <div ref={ref} style={style} />
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```powershell
cd "C:\Users\seunghoon\Projects\sdf-digital-twin\frontend"
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/BaseECharts.tsx
git commit -m "feat: add BaseECharts — Layer 3 imperative control wrapper"
```

---

## Task 2: Create `useSensorChart` + refactor `SensorChart`

**Files:**
- Create: `frontend/hooks/useSensorChart.ts`
- Modify: `frontend/components/SensorChart.tsx`

**Layer 1** — `useSensorChart` reads history from the Zustand store.
**Layer 2** — `SensorChart` maps history to a full ECharts option object and renders `BaseECharts`.

- [ ] **Step 1: Create `frontend/hooks/useSensorChart.ts`**

```ts
import { useFactoryStore } from "@/store/factoryStore"

export function useSensorChart(machineId: string) {
  const history = useFactoryStore((s) => s.machines[machineId]?.history)
  return { history }
}
```

- [ ] **Step 2: Rewrite `frontend/components/SensorChart.tsx`**

```tsx
"use client"
import { useMemo } from "react"
import { BaseECharts } from "@/components/BaseECharts"
import { useSensorChart } from "@/hooks/useSensorChart"

interface Props {
  machineId: string
  label?: string
}

const SERIES_CONFIG = [
  { name: "진동(Hz)", color: "#3b82f6", index: 1 },
  { name: "온도(°C)", color: "#f59e0b", index: 2 },
  { name: "전류(A)",  color: "#10b981", index: 3 },
]

export function SensorChart({ machineId, label }: Props) {
  const { history } = useSensorChart(machineId)
  const pts = history?.length ?? 0

  const option = useMemo(() => ({
    backgroundColor: "transparent",
    animation: false,
    grid: { left: 36, right: 10, top: 18, bottom: 18 },
    xAxis: {
      type: "time",
      splitLine: { show: false },
      axisLabel: { fontSize: 9, color: "#6b7280" },
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: "#1f2937" } },
      axisLabel: { fontSize: 9, color: "#6b7280" },
    },
    legend: {
      data: SERIES_CONFIG.map((s) => s.name),
      top: 0,
      right: 8,
      textStyle: { fontSize: 9, color: "#9ca3af" },
      itemWidth: 10,
      itemHeight: 6,
    },
    series: SERIES_CONFIG.map((s) => ({
      name: s.name,
      type: "line",
      data: history ? history.map((row) => [row[0], row[s.index]]) : [],
      smooth: true,
      symbol: "none",
      lineStyle: { color: s.color, width: 1.5 },
    })),
  }), [history])

  return (
    <div className="bg-gray-900 rounded-lg p-2">
      <p className="text-xs text-gray-400 mb-1">
        {label ?? machineId}
        <span className="ml-2 text-gray-600 font-mono">
          {pts > 0 ? `${pts}pts` : "대기 중..."}
        </span>
      </p>
      <BaseECharts option={option} notMerge={false} />
    </div>
  )
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```powershell
cd "C:\Users\seunghoon\Projects\sdf-digital-twin\frontend"
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/hooks/useSensorChart.ts frontend/components/SensorChart.tsx
git commit -m "refactor: SensorChart → useSensorChart hook + BaseECharts (3-layer)"
```

---

## Task 3: Create `useMachineDetail` + refactor `MachineDetailPanel`

**Files:**
- Create: `frontend/hooks/useMachineDetail.ts`
- Modify: `frontend/components/MachineDetailPanel.tsx`

**Layer 1** — `useMachineDetail` reads detail and fault data from store, computes `criticalParts`.
**Layer 2** — `WearBars` and `ThermalHeatmap` are view-assembly sub-components that map data to ECharts options and use `BaseECharts`. `MachineDetailPanel` composes everything using the hook.

- [ ] **Step 1: Create `frontend/hooks/useMachineDetail.ts`**

```ts
import { useFactoryStore } from "@/store/factoryStore"
import type { MachineDetail, ComponentFaultMap } from "@/lib/types"

export interface CriticalPart {
  part: string
  description: string
}

export function useMachineDetail(machineId: string): {
  detail: MachineDetail | undefined
  criticalParts: CriticalPart[]
} {
  const detail = useFactoryStore((s) => s.machineDetails[machineId])
  const fault = useFactoryStore((s) => s.componentFaults[machineId])

  const criticalParts: CriticalPart[] = fault
    ? Object.entries(fault.faultedParts)
        .filter(([, v]) => v.severity === "critical")
        .map(([part, v]) => ({ part, description: v.description }))
    : []

  return { detail, criticalParts }
}
```

- [ ] **Step 2: Rewrite `frontend/components/MachineDetailPanel.tsx`**

```tsx
"use client"
import { useMemo } from "react"
import { BaseECharts } from "@/components/BaseECharts"
import { useMachineDetail } from "@/hooks/useMachineDetail"
import type { ComponentStatus } from "@/lib/types"

const STATUS_COLOR: Record<string, string> = {
  ok: "#10b981",
  warn: "#f59e0b",
  critical: "#ef4444",
}

const PART_LABELS: Record<string, string> = {
  body: "메인 하우징",
  motor: "구동부",
  actuator: "작동부",
  sensor_unit: "센서",
}

// Layer 2: View Assembly — maps components data to ECharts option
function WearBars({ components }: { components: Record<string, ComponentStatus> }) {
  const option = useMemo(() => {
    const parts = Object.entries(components)
    return {
      backgroundColor: "transparent",
      animation: false,
      grid: { left: 80, right: 40, top: 10, bottom: 10 },
      xAxis: {
        type: "value",
        max: 100,
        splitLine: { lineStyle: { color: "#374151" } },
      },
      yAxis: {
        type: "category",
        data: parts.map(([p]) => PART_LABELS[p] ?? p),
        axisLabel: { color: "#9ca3af", fontSize: 11 },
      },
      series: [{
        type: "bar",
        data: parts.map(([, v]) => ({
          value: v.wear,
          itemStyle: { color: STATUS_COLOR[v.status] ?? "#6b7280" },
        })),
        label: {
          show: true,
          position: "right",
          formatter: "{c}%",
          color: "#d1d5db",
          fontSize: 10,
        },
      }],
    }
  }, [components])

  return <BaseECharts option={option} style={{ width: "100%", height: 120 }} />
}

// Layer 2: View Assembly — maps grid data to ECharts option
function ThermalHeatmap({ grid }: { grid: number[][] }) {
  const option = useMemo(() => {
    if (!grid.length) return null
    const data: [number, number, number][] = []
    grid.forEach((row, r) => row.forEach((val, c) => data.push([c, r, val])))
    return {
      backgroundColor: "transparent",
      animation: false,
      grid: { left: 10, right: 60, top: 10, bottom: 10 },
      xAxis: {
        type: "category",
        data: ["0", "1", "2", "3"],
        splitArea: { show: true },
      },
      yAxis: {
        type: "category",
        data: ["0", "1", "2", "3"],
        splitArea: { show: true },
      },
      visualMap: {
        min: 0,
        max: 1,
        calculable: true,
        orient: "vertical",
        right: 0,
        inRange: { color: ["#1e3a5f", "#f59e0b", "#ef4444"] },
      },
      series: [{ type: "heatmap", data, label: { show: false } }],
    }
  }, [grid])

  return <BaseECharts option={option} style={{ width: "100%", height: 130 }} />
}

// Layer 2: View Assembly — composes hook data + sub-components
export function MachineDetailPanel({
  machineId,
  label,
}: {
  machineId: string
  label?: string
}) {
  const { detail, criticalParts } = useMachineDetail(machineId)

  if (!detail) {
    return (
      <div className="bg-gray-900 rounded-xl p-4 w-full text-gray-500 text-sm animate-pulse">
        데이터 로딩 중...
      </div>
    )
  }

  return (
    <div className="bg-gray-900 rounded-xl p-4 w-full space-y-3">
      <div>
        <p className="font-semibold text-gray-100">{label ?? machineId}</p>
        <p className="text-xs text-gray-400 flex items-center gap-2 mt-0.5">
          <span
            className={`w-2 h-2 rounded-full inline-block ${
              detail.operationRate > 50 ? "bg-green-400" : "bg-red-400"
            }`}
          />
          가동률 {detail.operationRate.toFixed(1)}%
        </p>
      </div>

      {criticalParts.length > 0 && (
        <div className="bg-red-900/40 border border-red-700 rounded p-2">
          <p className="text-xs text-red-300 font-medium">고장 감지</p>
          {criticalParts.map(({ part, description }) => (
            <p key={part} className="text-xs text-red-400">
              {PART_LABELS[part] ?? part}: {description}
            </p>
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

- [ ] **Step 3: Verify TypeScript compiles**

```powershell
cd "C:\Users\seunghoon\Projects\sdf-digital-twin\frontend"
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/hooks/useMachineDetail.ts frontend/components/MachineDetailPanel.tsx
git commit -m "refactor: MachineDetailPanel → useMachineDetail hook + BaseECharts (3-layer)"
```

---

## Task 4: Create `usePalette` + refactor `Palette`

**Files:**
- Create: `frontend/hooks/usePalette.ts`
- Modify: `frontend/components/Palette.tsx`

**Layer 1** — `usePalette` owns all store access and interaction logic.
**Layer 2** — `Palette` renders using hook data only.

- [ ] **Step 1: Create `frontend/hooks/usePalette.ts`**

```ts
import { useState } from "react"
import { useFactoryStore } from "@/store/factoryStore"
import type { EntityType, PlacedEntity } from "@/lib/types"

const MACHINE_TYPES: EntityType[] = ["press", "cnc", "conveyor"]
const ROBOT_TYPES: EntityType[] = ["robot"]

export const TYPE_ICON: Record<string, string> = {
  press: "⬛",
  cnc: "⚙",
  conveyor: "▬",
  robot: "◎",
}

export function usePalette() {
  const [modalOpen, setModalOpen] = useState(false)

  const placedEntities   = useFactoryStore((s) => s.placedEntities)
  const placementMode    = useFactoryStore((s) => s.placementMode)
  const exitPlacementMode = useFactoryStore((s) => s.exitPlacementMode)
  const removeEntity     = useFactoryStore((s) => s.removeEntity)
  const selectedEntityId = useFactoryStore((s) => s.selectedEntityId)
  const selectEntity     = useFactoryStore((s) => s.selectEntity)

  const machines: PlacedEntity[] = placedEntities.filter((e) =>
    MACHINE_TYPES.includes(e.type)
  )
  const robots: PlacedEntity[] = placedEntities.filter((e) =>
    ROBOT_TYPES.includes(e.type)
  )

  const handleItemClick = (poolId: string) => {
    if (placementMode?.poolId === poolId) {
      exitPlacementMode()
      return
    }
    selectEntity(selectedEntityId === poolId ? null : poolId)
  }

  return {
    modalOpen,
    setModalOpen,
    machines,
    robots,
    placedEntities,
    placementMode,
    selectedEntityId,
    removeEntity,
    handleItemClick,
  }
}
```

- [ ] **Step 2: Rewrite `frontend/components/Palette.tsx`**

```tsx
"use client"
import { AddEntityModal } from "@/components/AddEntityModal"
import { usePalette, TYPE_ICON } from "@/hooks/usePalette"
import type { EntityType } from "@/lib/types"

export function Palette() {
  const {
    modalOpen,
    setModalOpen,
    machines,
    robots,
    placedEntities,
    placementMode,
    selectedEntityId,
    removeEntity,
    handleItemClick,
  } = usePalette()

  const renderItem = (poolId: string, type: EntityType, label: string) => {
    const selected = selectedEntityId === poolId
    const active = placementMode?.poolId === poolId
    return (
      <div
        key={poolId}
        className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors cursor-pointer
          ${active
            ? "bg-yellow-600 text-white"
            : selected
            ? "bg-blue-700 text-white"
            : "bg-gray-800 text-gray-300 hover:bg-gray-700"
          }`}
        onClick={() => handleItemClick(poolId)}
      >
        <span>{TYPE_ICON[type]}</span>
        <span className="flex-1 truncate">{label}</span>
        <button
          onClick={(e) => {
            e.stopPropagation()
            removeEntity(poolId)
          }}
          className="text-gray-500 hover:text-red-400 text-xs flex-shrink-0"
        >
          ✕
        </button>
      </div>
    )
  }

  return (
    <>
      {modalOpen && <AddEntityModal onClose={() => setModalOpen(false)} />}

      <div className="bg-gray-900 rounded-xl p-3 w-44 space-y-3 select-none flex-shrink-0">
        {placementMode && (
          <div className="text-xs text-yellow-400 bg-yellow-900/30 rounded px-2 py-1">
            바닥을 클릭하여 배치
          </div>
        )}

        <button
          onClick={() => setModalOpen(true)}
          className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
        >
          <span>+</span>
          <span>추가</span>
        </button>

        {machines.length > 0 && (
          <section>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">기계</p>
            <div className="space-y-1">
              {machines.map(({ id, type, label }) => renderItem(id, type, label))}
            </div>
          </section>
        )}

        {robots.length > 0 && (
          <section>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">로봇</p>
            <div className="space-y-1">
              {robots.map(({ id, type, label }) => renderItem(id, type, label))}
            </div>
          </section>
        )}

        {placedEntities.length === 0 && !placementMode && (
          <p className="text-xs text-gray-600 text-center py-2">
            + 추가로 장비를 배치하세요
          </p>
        )}
      </div>
    </>
  )
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```powershell
cd "C:\Users\seunghoon\Projects\sdf-digital-twin\frontend"
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/hooks/usePalette.ts frontend/components/Palette.tsx
git commit -m "refactor: Palette → usePalette hook (3-layer)"
```

---

## Task 5: Create `useRobotDetail` + refactor `RobotDetailPanel`

**Files:**
- Create: `frontend/hooks/useRobotDetail.ts`
- Modify: `frontend/components/RobotDetailPanel.tsx`

**Layer 1** — `useRobotDetail` reads path and dispatch state from store.
**Layer 2** — `RobotDetailPanel` renders using hook data.

- [ ] **Step 1: Create `frontend/hooks/useRobotDetail.ts`**

```ts
import { useFactoryStore } from "@/store/factoryStore"
import type { RobotPathDetail } from "@/lib/types"

export function useRobotDetail(robotId: string): {
  path: RobotPathDetail | undefined
  isDispatched: boolean
} {
  const path = useFactoryStore((s) => s.robotPaths[robotId])
  const dispatch = useFactoryStore((s) => s.dispatchCommand)
  const isDispatched = dispatch?.robotId === robotId
  return { path, isDispatched }
}
```

- [ ] **Step 2: Rewrite `frontend/components/RobotDetailPanel.tsx`**

```tsx
"use client"
import { useRobotDetail } from "@/hooks/useRobotDetail"

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

export function RobotDetailPanel({
  robotId,
  label,
}: {
  robotId: string
  label?: string
}) {
  const { path, isDispatched } = useRobotDetail(robotId)

  return (
    <div className="bg-gray-900 rounded-xl p-4 w-full space-y-3">
      <div>
        <p className="font-semibold text-gray-100">{label ?? robotId}</p>
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

- [ ] **Step 3: Verify TypeScript compiles**

```powershell
cd "C:\Users\seunghoon\Projects\sdf-digital-twin\frontend"
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/hooks/useRobotDetail.ts frontend/components/RobotDetailPanel.tsx
git commit -m "refactor: RobotDetailPanel → useRobotDetail hook (3-layer)"
```

---

## Task 6: Update `Skill.md` status table

**Files:**
- Modify: `docs/Skill.md`

- [ ] **Step 1: Update the status table**

In `docs/Skill.md`, find the table at the bottom and replace it entirely with:

```markdown
| 컴포넌트 | Headless 분리 | HeadlessUI 사용 | OSS Ready |
|---|---|---|---|
| `AddEntityModal` | ✅ `useAddEntityModal` hook | ✅ HeadlessUI Dialog | ✅ |
| `Palette` | ✅ `usePalette` hook | ⬜ 미적용 | ⬜ |
| `MachineDetailPanel` | ✅ `useMachineDetail` hook + `BaseECharts` | ⬜ 미적용 | ⬜ |
| `SensorChart` | ✅ `useSensorChart` hook + `BaseECharts` | ⬜ 미적용 | ⬜ |
| `RobotDetailPanel` | ✅ `useRobotDetail` hook | ⬜ 미적용 | ⬜ |
```

Also update the refactoring order note below the table to:

```markdown
> 리팩터링 완료. 다음 단계: 각 컴포넌트에 HeadlessUI 프리미티브 적용 및 Storybook 스토리 추가.
```

- [ ] **Step 2: Commit**

```bash
git add docs/Skill.md
git commit -m "docs: update Skill.md — all components refactored to 3-layer architecture"
```

---

## Task 7: Final verification

- [ ] **Step 1: Run full test suite**

```powershell
cd "C:\Users\seunghoon\Projects\sdf-digital-twin\frontend"
npm test
```

Expected: all 8 tests pass.

- [ ] **Step 2: TypeScript clean compile**

```powershell
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Check git log**

```bash
git log --oneline -10
```

Expected: 6 new commits since the start of this refactor (BaseECharts, SensorChart, MachineDetailPanel, Palette, RobotDetailPanel, Skill.md).
