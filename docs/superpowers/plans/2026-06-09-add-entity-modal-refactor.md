# AddEntityModal Headless Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `AddEntityModal` into a Headless (logic) + Styled (visual) split per `docs/Skill.md`, using `@headlessui/react` Dialog for accessibility and extracting a reusable `EntityCard` component.

**Architecture:** Logic is extracted into `useAddEntityModal` hook (store access, count calculation, selection handler). Visual is split into `EntityCard` (single reusable card with OSS-ready props) and `AddEntityModal` (HeadlessUI Dialog + hook + cards — zero business logic). `Palette.tsx` import path stays the same.

**Tech Stack:** Next.js 14, React 18, TypeScript, @headlessui/react, Tailwind CSS, Zustand

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Install | `@headlessui/react` | Dialog primitive (ESC, focus trap, ARIA) |
| Create | `frontend/hooks/useAddEntityModal.ts` | All logic: store access, countOf, canAdd, select |
| Create | `frontend/components/EntityCard.tsx` | Single type card, props-only, no store dependency |
| Modify | `frontend/components/AddEntityModal.tsx` | HeadlessUI Dialog shell + hook + EntityCard, no logic |

---

## Task 1: Install @headlessui/react

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Install the package**

```powershell
cd frontend
npm install @headlessui/react
```

Expected output includes: `added 1 package` and `@headlessui/react` version line.

- [ ] **Step 2: Verify TypeScript can resolve the types**

```powershell
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "chore: install @headlessui/react for accessible Dialog primitive"
```

---

## Task 2: Create `useAddEntityModal` hook

**Files:**
- Create: `frontend/hooks/useAddEntityModal.ts`

This hook owns all business logic. It has no JSX and no Tailwind classes. A consumer can use it with any visual layer.

- [ ] **Step 1: Create the hook file**

`frontend/hooks/useAddEntityModal.ts`:

```ts
import { useFactoryStore } from "@/store/factoryStore"
import type { EntityType } from "@/lib/types"

export const TYPE_META = [
  { type: "press"    as EntityType, icon: "⬛", korLabel: "프레스" },
  { type: "cnc"      as EntityType, icon: "⚙",  korLabel: "CNC" },
  { type: "conveyor" as EntityType, icon: "▬",  korLabel: "컨베이어" },
  { type: "robot"    as EntityType, icon: "◎",  korLabel: "AMR" },
] as const

export const MAX_PER_TYPE = 5

export function useAddEntityModal() {
  const placedEntities     = useFactoryStore((s) => s.placedEntities)
  const enterPlacementMode = useFactoryStore((s) => s.enterPlacementMode)

  const countOf = (type: EntityType): number =>
    placedEntities.filter((e) => e.type === type).length

  const canAdd = (type: EntityType): boolean =>
    countOf(type) < MAX_PER_TYPE

  const select = (type: EntityType, onClose: () => void): void => {
    if (!canAdd(type)) return
    const count = countOf(type)
    const meta = TYPE_META.find((m) => m.type === type)!
    const label = `${meta.korLabel} #${count + 1}`
    const poolId = `${type}-${Date.now()}`
    enterPlacementMode(type, poolId, label)
    onClose()
  }

  return { typeMeta: TYPE_META, countOf, canAdd, select }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```powershell
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/hooks/useAddEntityModal.ts
git commit -m "feat: extract useAddEntityModal hook — logic layer for entity modal"
```

---

## Task 3: Create `EntityCard` component

**Files:**
- Create: `frontend/components/EntityCard.tsx`

This component knows nothing about the store or business rules. It renders a single type card given explicit props. The `renderBadge` render prop allows consumers to customize the count badge.

- [ ] **Step 1: Create the component file**

`frontend/components/EntityCard.tsx`:

```tsx
import type { EntityType } from "@/lib/types"

interface EntityCardProps {
  type: EntityType
  icon: string
  label: string
  count: number
  max: number
  disabled: boolean
  onSelect: () => void
  className?: string
  renderBadge?: (count: number, max: number) => React.ReactNode
}

export function EntityCard({
  icon,
  label,
  count,
  max,
  disabled,
  onSelect,
  className = "",
  renderBadge,
}: EntityCardProps) {
  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      className={[
        "flex flex-col items-center gap-2 rounded-xl p-4 border transition-colors",
        disabled
          ? "border-gray-700 bg-gray-800 text-gray-600 cursor-not-allowed"
          : "border-gray-600 bg-gray-800 text-gray-200 hover:border-blue-500 hover:bg-gray-700 cursor-pointer",
        className,
      ].join(" ")}
    >
      <span className="text-2xl">{icon}</span>
      <span className="text-sm font-medium">{label}</span>
      {renderBadge ? (
        renderBadge(count, max)
      ) : (
        <span className={`text-xs ${disabled ? "text-gray-600" : "text-gray-400"}`}>
          {count} / {max}
        </span>
      )}
    </button>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```powershell
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/EntityCard.tsx
git commit -m "feat: add EntityCard — OSS-ready reusable type card component"
```

---

## Task 4: Refactor `AddEntityModal` to HeadlessUI Dialog

**Files:**
- Modify: `frontend/components/AddEntityModal.tsx`

Replace the entire file. The component now contains zero business logic — it composes `useAddEntityModal` + `EntityCard` inside a HeadlessUI `Dialog`. Dialog handles ESC key, focus trap, `aria-modal`, and backdrop click automatically.

- [ ] **Step 1: Rewrite the file**

`frontend/components/AddEntityModal.tsx`:

```tsx
"use client"
import { Dialog } from "@headlessui/react"
import { useAddEntityModal, MAX_PER_TYPE } from "@/hooks/useAddEntityModal"
import { EntityCard } from "@/components/EntityCard"

interface Props {
  onClose: () => void
}

export function AddEntityModal({ onClose }: Props) {
  const { typeMeta, countOf, canAdd, select } = useAddEntityModal()

  return (
    <Dialog open onClose={onClose} className="relative z-50">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60" aria-hidden="true" />

      {/* Panel */}
      <div className="fixed inset-0 flex items-center justify-center">
        <Dialog.Panel className="bg-gray-900 rounded-2xl p-6 w-80 shadow-2xl border border-gray-700">
          <div className="flex items-center justify-between mb-5">
            <Dialog.Title className="text-white font-semibold text-base">
              장비 추가
            </Dialog.Title>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-300 text-lg leading-none"
              aria-label="닫기"
            >
              ✕
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {typeMeta.map(({ type, icon, korLabel }) => (
              <EntityCard
                key={type}
                type={type}
                icon={icon}
                label={korLabel}
                count={countOf(type)}
                max={MAX_PER_TYPE}
                disabled={!canAdd(type)}
                onSelect={() => select(type, onClose)}
              />
            ))}
          </div>

          <p className="text-gray-500 text-xs text-center mt-4">
            카드를 클릭하면 배치 모드로 전환됩니다
          </p>
        </Dialog.Panel>
      </div>
    </Dialog>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```powershell
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/AddEntityModal.tsx
git commit -m "refactor: AddEntityModal → HeadlessUI Dialog + useAddEntityModal + EntityCard"
```

---

## Task 5: Update `Skill.md` applied status

**Files:**
- Modify: `docs/Skill.md`

- [ ] **Step 1: Mark AddEntityModal as refactored in the status table**

In `docs/Skill.md`, find the table at the bottom and update the `AddEntityModal` row:

```markdown
| `AddEntityModal` | ✅ `useAddEntityModal` hook | ✅ HeadlessUI Dialog | ✅ |
```

- [ ] **Step 2: Commit**

```bash
git add docs/Skill.md
git commit -m "docs: mark AddEntityModal as HeadlessUI-refactored in Skill.md"
```

---

## Task 6: Manual verification

- [ ] **Step 1: Start dev server**

```powershell
cd frontend && npm run dev
```

Open `http://localhost:3000`.

- [ ] **Step 2: Verify modal opens**

Click "+ 추가" in the Palette. The modal should appear with 4 type cards.

- [ ] **Step 3: Verify ESC closes the modal**

Press `Escape`. Modal should close without clicking ✕ or backdrop.

- [ ] **Step 4: Verify focus trap**

While modal is open, press `Tab` repeatedly. Focus should cycle only within the modal panel (close button → 4 cards → close button).

- [ ] **Step 5: Verify placement flow still works**

Click "프레스" card → modal closes → "바닥을 클릭하여 배치" hint appears in Palette → click canvas floor → entity appears.

- [ ] **Step 6: Verify limit enforcement**

Add 5 press entities. Open modal. 프레스 card should be grayed and non-clickable.
