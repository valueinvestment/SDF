# Add Entity Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "+ 추가" button to the Palette sidebar that opens a modal for selecting entity types (press/cnc/conveyor/robot), with a limit of 5 per type, and immediately enters placement mode upon selection.

**Architecture:** The modal (`AddEntityModal.tsx`) is a pure UI component that reads `placedEntities` from the store to derive per-type counts and calls `enterPlacementMode` when a type card is clicked. The Palette is refactored to render placed entities dynamically from the store instead of a hardcoded pool array. No new store state is required.

**Tech Stack:** Next.js 14 (App Router), React, TypeScript, Zustand, Tailwind CSS

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `frontend/components/AddEntityModal.tsx` | Modal UI — type cards, count display, disabled state |
| Modify | `frontend/components/Palette.tsx` | Add "+ 추가" button, replace static POOL arrays with dynamic `placedEntities` |
| Modify | `frontend/store/factoryStore.ts` | Add `generateEntityId` helper used by `enterPlacementMode` callers |

---

## Task 1: Create `AddEntityModal.tsx`

**Files:**
- Create: `frontend/components/AddEntityModal.tsx`

### Type card metadata

```ts
const TYPE_META: {
  type: EntityType
  label: string
  icon: string
  korLabel: string
}[] = [
  { type: "press",    label: "Press",     icon: "⬛", korLabel: "프레스" },
  { type: "cnc",      label: "CNC",       icon: "⚙",  korLabel: "CNC" },
  { type: "conveyor", label: "Conveyor",  icon: "▬",  korLabel: "컨베이어" },
  { type: "robot",    label: "Robot",     icon: "◎",  korLabel: "AMR" },
]
const MAX_PER_TYPE = 5
```

- [ ] **Step 1: Create the modal file**

`frontend/components/AddEntityModal.tsx`:

```tsx
"use client"
import { useFactoryStore } from "@/store/factoryStore"
import type { EntityType } from "@/lib/types"

const TYPE_META = [
  { type: "press"    as EntityType, icon: "⬛", korLabel: "프레스" },
  { type: "cnc"      as EntityType, icon: "⚙",  korLabel: "CNC" },
  { type: "conveyor" as EntityType, icon: "▬",  korLabel: "컨베이어" },
  { type: "robot"    as EntityType, icon: "◎",  korLabel: "AMR" },
]
const MAX_PER_TYPE = 5

interface Props {
  onClose: () => void
}

export function AddEntityModal({ onClose }: Props) {
  const placedEntities   = useFactoryStore((s) => s.placedEntities)
  const enterPlacementMode = useFactoryStore((s) => s.enterPlacementMode)

  const countOf = (type: EntityType) =>
    placedEntities.filter((e) => e.type === type).length

  const handleSelect = (type: EntityType) => {
    const count = countOf(type)
    if (count >= MAX_PER_TYPE) return

    const n = count + 1
    const meta = TYPE_META.find((m) => m.type === type)!
    const label = `${meta.korLabel} #${n}`
    const poolId = `${type}-${Date.now()}`

    enterPlacementMode(type, poolId, label)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 rounded-2xl p-6 w-80 shadow-2xl border border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-semibold text-base">장비 추가</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {TYPE_META.map(({ type, icon, korLabel }) => {
            const count = countOf(type)
            const disabled = count >= MAX_PER_TYPE
            return (
              <button
                key={type}
                onClick={() => handleSelect(type)}
                disabled={disabled}
                className={`flex flex-col items-center gap-2 rounded-xl p-4 border transition-colors
                  ${disabled
                    ? "border-gray-700 bg-gray-800 text-gray-600 cursor-not-allowed"
                    : "border-gray-600 bg-gray-800 text-gray-200 hover:border-blue-500 hover:bg-gray-700 cursor-pointer"
                  }`}
              >
                <span className="text-2xl">{icon}</span>
                <span className="text-sm font-medium">{korLabel}</span>
                <span className={`text-xs ${disabled ? "text-gray-600" : "text-gray-400"}`}>
                  {count} / {MAX_PER_TYPE}
                </span>
              </button>
            )
          })}
        </div>

        <p className="text-gray-500 text-xs text-center mt-4">
          카드를 클릭하면 배치 모드로 전환됩니다
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```powershell
cd frontend && npx tsc --noEmit
```

Expected: no errors related to `AddEntityModal.tsx`.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/AddEntityModal.tsx
git commit -m "feat: add AddEntityModal with per-type 5-item limit"
```

---

## Task 2: Refactor `Palette.tsx` — dynamic list + "+ 추가" button

**Files:**
- Modify: `frontend/components/Palette.tsx`

The current Palette uses two hardcoded arrays (`POOL_MACHINES`, `POOL_ROBOTS`). Replace them with dynamic rendering from `placedEntities` and wire up the modal.

- [ ] **Step 1: Rewrite `Palette.tsx`**

Replace the entire file content with:

```tsx
"use client"
import { useState } from "react"
import { useFactoryStore } from "@/store/factoryStore"
import { AddEntityModal } from "@/components/AddEntityModal"
import type { EntityType } from "@/lib/types"

const TYPE_ICON: Record<string, string> = {
  press: "⬛", cnc: "⚙", conveyor: "▬", robot: "◎",
}

const MACHINE_TYPES: EntityType[] = ["press", "cnc", "conveyor"]
const ROBOT_TYPES: EntityType[] = ["robot"]

export function Palette() {
  const [modalOpen, setModalOpen] = useState(false)

  const placedEntities   = useFactoryStore((s) => s.placedEntities)
  const placementMode    = useFactoryStore((s) => s.placementMode)
  const enterPlacementMode = useFactoryStore((s) => s.enterPlacementMode)
  const exitPlacementMode  = useFactoryStore((s) => s.exitPlacementMode)
  const removeEntity     = useFactoryStore((s) => s.removeEntity)
  const selectedEntityId = useFactoryStore((s) => s.selectedEntityId)
  const selectEntity     = useFactoryStore((s) => s.selectEntity)

  const machines = placedEntities.filter((e) => MACHINE_TYPES.includes(e.type))
  const robots   = placedEntities.filter((e) => ROBOT_TYPES.includes(e.type))

  const handleItemClick = (poolId: string, type: EntityType, label: string) => {
    if (placementMode?.poolId === poolId) { exitPlacementMode(); return }
    if (selectedEntityId === poolId) { selectEntity(null); return }
    selectEntity(poolId)
  }

  const renderItem = (poolId: string, type: EntityType, label: string) => {
    const selected = selectedEntityId === poolId
    const active   = placementMode?.poolId === poolId
    return (
      <div
        key={poolId}
        className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors cursor-pointer
          ${active   ? "bg-yellow-600 text-white"
          : selected ? "bg-blue-700 text-white"
          :            "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}
        onClick={() => handleItemClick(poolId, type, label)}
      >
        <span>{TYPE_ICON[type]}</span>
        <span className="flex-1 truncate">{label}</span>
        <button
          onClick={(e) => { e.stopPropagation(); removeEntity(poolId) }}
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

        {placedEntities.length === 0 && (
          <p className="text-xs text-gray-600 text-center py-2">
            + 추가로 장비를 배치하세요
          </p>
        )}
      </div>
    </>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```powershell
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/Palette.tsx
git commit -m "feat: refactor Palette to dynamic entity list with add modal trigger"
```

---

## Task 3: Clear pre-populated entities from store (start empty)

**Files:**
- Modify: `frontend/store/factoryStore.ts` lines 100–109

The store currently pre-populates `placedEntities` with 8 hardcoded entities. Clear this so the canvas starts empty and users add via the modal.

- [ ] **Step 1: Clear `placedEntities` initial value**

In `frontend/store/factoryStore.ts`, find:

```ts
  placedEntities: [
    { id: "M1", type: "press",    x: 3,  z: 3,  label: "프레스" },
    { id: "M2", type: "cnc",      x: 7,  z: 3,  label: "CNC" },
    { id: "M3", type: "cnc",      x: 12, z: 3,  label: "CNC #2" },
    { id: "M4", type: "conveyor", x: 3,  z: 12, label: "컨베이어" },
    { id: "M5", type: "press",    x: 12, z: 12, label: "프레스 #2" },
    { id: "R1", type: "robot",    x: 10, z: 10, label: "AMR #1" },
    { id: "R2", type: "robot",    x: 5,  z: 5,  label: "AMR #2" },
    { id: "R3", type: "robot",    x: 15, z: 5,  label: "AMR #3" },
  ] as PlacedEntity[],
```

Replace with:

```ts
  placedEntities: [] as PlacedEntity[],
```

- [ ] **Step 2: Verify TypeScript compiles**

```powershell
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/store/factoryStore.ts
git commit -m "feat: start with empty canvas — entities added via modal"
```

---

## Task 4: Manual verification

- [ ] **Step 1: Start dev server**

```powershell
cd frontend && npm run dev
```

Open `http://localhost:3000`.

- [ ] **Step 2: Verify empty state**

Canvas is empty. Palette shows only the "+ 추가" 버튼 and the empty-state message "+ 추가로 장비를 배치하세요".

- [ ] **Step 3: Verify modal opens**

Click "+ 추가" → modal appears with 4 type cards (프레스, CNC, 컨베이어, AMR), each showing "0 / 5".

- [ ] **Step 4: Verify placement flow**

Click "프레스" card → modal closes → Palette shows "바닥을 클릭하여 배치" hint → click canvas floor → "프레스 #1" appears in Palette under 기계 section and on 3D canvas.

- [ ] **Step 5: Verify count tracking**

Open modal again → 프레스 shows "1 / 5".

- [ ] **Step 6: Verify limit enforcement**

Add 4 more 프레스 (total 5) → open modal → 프레스 card is grayed out and unclickable.

- [ ] **Step 7: Verify remove**

Click ✕ on "프레스 #1" in Palette → entity disappears from canvas and Palette → open modal → 프레스 shows "4 / 5" again.

- [ ] **Step 8: Final commit if any fixes were made**

```bash
git add -p
git commit -m "fix: address issues found during manual verification"
```
