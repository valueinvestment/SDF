# Phase 5b — 룰 에디터 드래그 인터랙션 확장 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `RuleEditorPanel`에 머신↔룰 양방향 드래그 스코핑(A: 머신→신규 룰 폼, C: 저장된 룰→머신)과 조건식 입력의 "간단 모드"(변수/연산자 드롭다운, 기존 텍스트 모드와 병행)를 추가하고, 그 과정에서 발견된 `validateFormula`의 커스텀 지표 이름 오거부 버그를 고친다.

**Architecture:** 네이티브 HTML5 Drag and Drop API(신규 의존성 없음)로 커스텀 MIME 타입(`application/x-sdf-machine`, `application/x-sdf-rule`) 페이로드를 주고받는다. `Rule.machineId`/`factoryStore`의 `addRule`/`updateRule`은 기존 그대로 재사용하며 타입 변경이 없다. `packages/types`에 `BASE_RULE_VARIABLES` 상수, `packages/core-sdk`에 `listAvailableVariables` 함수를 추가해 "이 머신 스코프에서 쓸 수 있는 변수 이름"을 한 곳에서 정의하고, `RuleEditorPanel`/`FormulaEditor` 양쪽에서 재사용한다.

**Tech Stack:** Next.js 14 (App Router), React, Zustand, TypeScript, Tailwind CSS, Vitest + @testing-library/react. 모노레포 워크스페이스 패키지: `@sdf/types`, `@sdf/core-sdk`, `apps/host-twin`.

**설계 문서:** `docs/superpowers/specs/2026-07-29-plugin-platform-phase5b-rule-editor-drag-design.md`

---

## Task 1: `@sdf/types`에 `BASE_RULE_VARIABLES` 상수 추가

**Files:**
- Modify: `packages/types/src/index.ts:245-259`

- [ ] **Step 1: 상수 추가**

`packages/types/src/index.ts`의 기존 룰 엔진 섹션(`RuleVariable` 타입 바로 아래)에 추가한다:

```ts
// ─── Dynamic Rule Engine ────────────────────────────────────────

export type RuleVariable =
  | "vibration" | "temperature" | "current"
  | string

/**
 * 룰 조건/커스텀 지표에서 항상 쓸 수 있는 기본 센서 변수.
 * RuleEditorPanel/FormulaEditor/formulaEngine이 각자 하드코딩하지 않고
 * 전부 이 상수를 통해 참조한다 — 나중에 백엔드가 가변 센서 변수를
 * 지원하게 되면 이 배열(또는 이 배열을 만드는 소스)만 바꾸면 된다.
 */
export const BASE_RULE_VARIABLES: readonly string[] = ["vibration", "temperature", "current"]

export type RuleActionType = "overlay_color" | "alert_popup" | "play_sound" | "webhook_post"
```

(`RuleActionType` 이하 기존 코드는 그대로 둔다 — `BASE_RULE_VARIABLES` 상수 선언만 `RuleVariable`과 `RuleActionType` 사이에 끼워 넣는다.)

- [ ] **Step 2: 타입체크로 확인**

Run: `cd packages/types && npm run typecheck`
Expected: 에러 없이 통과 (이 패키지엔 별도 테스트 러너가 없음 — `BASE_RULE_VARIABLES`의 실제 사용은 Task 2의 테스트에서 검증된다)

- [ ] **Step 3: 커밋**

```bash
git add packages/types/src/index.ts
git commit -m "feat(types): add BASE_RULE_VARIABLES constant"
```

---

## Task 2: `@sdf/core-sdk`에 `listAvailableVariables` 추가 + `validateFormula` 버그 수정

**배경:** `validateFormula(formula)`는 인자 없이 내부에서 `{ vibration: 1, temperature: 1, current: 1 }`을 하드코딩해서 검증 샘플로 쓴다. 즉 조건식/지표 수식이 커스텀 지표(`ComputedMetric`) 이름을 참조하면 런타임(`useRuleEngine.ts`)에서는 정상 평가되지만 입력 시점 검증에서는 항상 "Unknown variable"로 잘못 거부된다. 이 Task에서 `validateFormula`가 호출자가 넘긴 추가 변수 이름도 샘플에 포함하도록 고치고, "이 머신 스코프에서 쓸 수 있는 변수 목록"을 계산하는 `listAvailableVariables`를 추가한다.

**Files:**
- Modify: `packages/core-sdk/src/formulaEngine.ts:166-194`
- Modify: `packages/core-sdk/src/index.ts:1-5`
- Test: `apps/host-twin/__tests__/formulaEngine.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/host-twin/__tests__/formulaEngine.test.ts` 맨 위 import를 다음으로 교체한다:

```ts
import { describe, it, expect } from "vitest"
import {
  evaluateFormula,
  evaluateCondition,
  validateFormula,
  listAvailableVariables,
} from "@sdf/core-sdk"
import { BASE_RULE_VARIABLES } from "@sdf/types"
import type { ComputedMetric } from "@sdf/types"
```

파일 맨 끝(기존 `describe("validateFormula", ...)` 블록 뒤)에 추가한다:

```ts
describe("validateFormula — extraVariableNames", () => {
  it("rejects a computed-metric name when not passed as an extra variable (pre-existing bug, locked in as current behavior)", () => {
    const r = validateFormula("heat_index > 50")
    expect(r.valid).toBe(false)
  })

  it("accepts a computed-metric name when passed via extraVariableNames", () => {
    const r = validateFormula("heat_index > 50", ["heat_index"])
    expect(r.valid).toBe(true)
  })

  it("still validates base variables without any extraVariableNames", () => {
    expect(validateFormula("temperature > 100").valid).toBe(true)
  })
})

describe("listAvailableVariables", () => {
  const metrics: ComputedMetric[] = [
    { id: "heat_index", name: "열지수", formula: "(vibration+temperature)/2", color: "#fff", machineId: null },
    { id: "m1_only", name: "M1 전용", formula: "current * 2", color: "#fff", machineId: "M1" },
    { id: "m2_only", name: "M2 전용", formula: "current * 3", color: "#fff", machineId: "M2" },
  ]

  it("always includes the base variables", () => {
    const result = listAvailableVariables(null, [])
    expect(result).toEqual([...BASE_RULE_VARIABLES])
  })

  it("includes global (machineId: null) computed metrics regardless of scope", () => {
    const result = listAvailableVariables("M1", metrics)
    expect(result).toContain("heat_index")
  })

  it("includes only the computed metrics scoped to the given machine, not other machines'", () => {
    const result = listAvailableVariables("M1", metrics)
    expect(result).toContain("m1_only")
    expect(result).not.toContain("m2_only")
  })

  it("includes only global computed metrics when machineId is null", () => {
    const result = listAvailableVariables(null, metrics)
    expect(result).toContain("heat_index")
    expect(result).not.toContain("m1_only")
    expect(result).not.toContain("m2_only")
  })
})
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `cd apps/host-twin && npx vitest run __tests__/formulaEngine.test.ts`
Expected: FAIL — `listAvailableVariables`가 `@sdf/core-sdk`에 없어서 import 에러, 그리고 "accepts a computed-metric name when passed via extraVariableNames" 케이스가 아직 실패

- [ ] **Step 3: `formulaEngine.ts` 수정**

`packages/core-sdk/src/formulaEngine.ts` 맨 위 import를 다음으로 교체한다:

```ts
import type { FormulaResult, ComputedMetric } from "@sdf/types"
import { BASE_RULE_VARIABLES } from "@sdf/types"
```

파일 끝의 `validateFormula`를 다음으로 교체한다:

```ts
export function validateFormula(
  formula: string,
  extraVariableNames: readonly string[] = [],
): { valid: boolean; error?: string } {
  const sampleVars: Record<string, number> = {}
  for (const name of BASE_RULE_VARIABLES) sampleVars[name] = 1
  for (const name of extraVariableNames) sampleVars[name] = 1
  const result = evaluateFormula(formula, sampleVars)
  if (result.ok) return { valid: true }
  return { valid: false, error: result.error }
}

/**
 * 주어진 머신 스코프(machineId)에서 룰 조건/지표 수식에 쓸 수 있는
 * 변수 이름 목록을 반환한다 — 기본 센서 변수 + 스코프에 맞는 커스텀 지표.
 * RuleEditorPanel의 변수 드롭다운, FormulaEditor의 힌트 문구/검증이
 * 모두 이 함수 하나를 통해 "쓸 수 있는 변수가 무엇인가"를 정의한다.
 */
export function listAvailableVariables(
  machineId: string | null,
  computedMetrics: ComputedMetric[],
): string[] {
  return [
    ...BASE_RULE_VARIABLES,
    ...computedMetrics
      .filter((m) => m.machineId === null || m.machineId === machineId)
      .map((m) => m.id),
  ]
}
```

- [ ] **Step 4: export 추가**

`packages/core-sdk/src/index.ts`를 다음으로 교체한다:

```ts
export {
  evaluateFormula,
  evaluateCondition,
  validateFormula,
  listAvailableVariables,
} from "./formulaEngine"

export {
  gaussianRandom,
  sineWithNoise,
  getPhaseOffset,
  computeMachineStatus,
  DEFAULT_SIMULATOR_CONFIG,
  type SimulatorConfig,
  type SimulatorTickResult,
} from "./simulator"
```

- [ ] **Step 5: 테스트 실행해서 통과 확인**

Run: `cd apps/host-twin && npx vitest run __tests__/formulaEngine.test.ts`
Expected: PASS, 전체 케이스 통과

- [ ] **Step 6: 커밋**

```bash
git add packages/core-sdk/src/formulaEngine.ts packages/core-sdk/src/index.ts apps/host-twin/__tests__/formulaEngine.test.ts
git commit -m "fix(core-sdk): validateFormula no longer rejects computed-metric names

Add extraVariableNames param and listAvailableVariables() to compute
which variable names are usable at a given machine scope."
```

---

## Task 3: `FormulaEditor.tsx`가 `listAvailableVariables`를 쓰도록 수정

**배경:** `FormulaEditor.tsx`는 `validateFormula(v)`를 인자 없이 호출하고 있어서, 한 커스텀 지표의 수식이 다른 커스텀 지표를 참조하면 (Task 2에서 고치기 전과 동일하게) "Unknown variable"로 잘못 거부된다. 힌트 문구도 `"변수: vibration, temperature, current"`로 하드코딩돼 있다.

**Files:**
- Modify: `apps/host-twin/components/FormulaEditor.tsx`
- Test: `apps/host-twin/__tests__/FormulaEditor.test.tsx` (신규)

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/host-twin/__tests__/FormulaEditor.test.tsx`를 새로 만든다:

```tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { useFactoryStore } from "@/store/factoryStore"
import { FormulaEditor } from "@/components/FormulaEditor"

function resetStore() {
  useFactoryStore.setState({ computedMetrics: [] })
}

describe("FormulaEditor", () => {
  it("shows the base variable names in the hint text", () => {
    resetStore()
    render(<FormulaEditor machineId="M1" />)
    expect(screen.getByText(/vibration, temperature, current/)).toBeInTheDocument()
  })

  it("includes an existing global computed metric's id in the hint text", () => {
    resetStore()
    useFactoryStore.setState({
      computedMetrics: [
        { id: "heat_index", name: "열지수", formula: "(vibration+temperature)/2", color: "#06b6d4", machineId: null },
      ],
    })
    render(<FormulaEditor machineId="M1" />)
    expect(screen.getByText(/heat_index/)).toBeInTheDocument()
  })

  it("accepts a formula that references an existing computed metric instead of rejecting it as an unknown variable", () => {
    resetStore()
    useFactoryStore.setState({
      computedMetrics: [
        { id: "heat_index", name: "열지수", formula: "(vibration+temperature)/2", color: "#06b6d4", machineId: null },
      ],
    })
    render(<FormulaEditor machineId="M1" />)
    const formulaInput = screen.getByPlaceholderText("(vibration + temperature) / 2")
    fireEvent.change(formulaInput, { target: { value: "heat_index * 2" } })
    expect(screen.queryByText(/Unknown variable/)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `cd apps/host-twin && npx vitest run __tests__/FormulaEditor.test.tsx`
Expected: FAIL — 세 번째 케이스가 실패(현재 `validateFormula(v)`가 인자 없이 호출되므로 `heat_index`를 모르는 변수로 거부). 첫/두 번째 케이스도 힌트 문구가 아직 정적 문자열이라 두 번째 케이스는 실패할 수 있음.

- [ ] **Step 3: `FormulaEditor.tsx` 수정**

import에 추가:

```ts
import { validateFormula, listAvailableVariables } from "@sdf/core-sdk"
```

(기존 `import { validateFormula } from "@sdf/core-sdk"` 줄을 위 줄로 교체)

`handleFormulaChange`를 다음으로 교체 (`packages/core-sdk`의 `listAvailableVariables`를 쓰려면 `metrics`가 이미 스코프 필터된 배열이므로 그대로 넘긴다):

```ts
const availableVars = listAvailableVariables(machineId, metrics)

const handleFormulaChange = (v: string) => {
  setFormula(v)
  if (!v.trim()) { setError(null); return }
  const result = validateFormula(v, availableVars)
  setError(result.valid ? null : (result.error ?? "유효하지 않은 수식"))
}
```

`handleAdd` 안의 검증도 같은 방식으로 고친다:

```ts
const handleAdd = () => {
  if (!name.trim() || !formula.trim()) return
  const check = validateFormula(formula, availableVars)
  if (!check.valid) { setError(check.error ?? "수식 오류"); return }
  addComputedMetric({ name: name.trim(), formula: formula.trim(), color, machineId })
  setName("")
  setFormula("")
  setError(null)
}
```

힌트 문구 줄을 다음으로 교체:

```tsx
<p className="text-[10px] text-gray-600">
  변수: {availableVars.join(", ")} · 함수: abs(), sqrt(), min(a,b), max(a,b)
</p>
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `cd apps/host-twin && npx vitest run __tests__/FormulaEditor.test.tsx`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/host-twin/components/FormulaEditor.tsx apps/host-twin/__tests__/FormulaEditor.test.tsx
git commit -m "fix(host-twin): FormulaEditor no longer rejects other computed-metric names"
```

---

## Task 4: 머신 → 신규 룰 폼 드래그 (A)

**Files:**
- Modify: `apps/host-twin/components/RuleEditorPanel.tsx`
- Test: `apps/host-twin/__tests__/RuleEditorPanel.test.tsx` (신규)

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/host-twin/__tests__/RuleEditorPanel.test.tsx`를 새로 만든다:

```tsx
import { describe, it, expect, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { useFactoryStore } from "@/store/factoryStore"
import { RuleEditorPanel } from "@/components/RuleEditorPanel"

function makeDataTransfer(payload: Record<string, string>) {
  const store = { ...payload }
  return {
    types: Object.keys(store),
    setData: (type: string, value: string) => { store[type] = value },
    getData: (type: string) => store[type] ?? "",
  }
}

beforeEach(() => {
  useFactoryStore.setState({
    rules: [],
    computedMetrics: [],
    placedEntities: [
      { id: "M1", type: "press", x: 0, z: 0, label: "프레스" },
      { id: "M2", type: "cnc", x: 1, z: 1, label: "CNC" },
      { id: "R1", type: "robot", x: 2, z: 2, label: "AMR" },
    ],
  })
})

describe("RuleEditorPanel — machine chip list", () => {
  it("lists only non-robot placed entities as machine chips", () => {
    render(<RuleEditorPanel />)
    // 머신 칩은 "🏭 " 아이콘 접두사와 함께 렌더링된다(아래 Step 4 JSX 참조)
    expect(screen.getByText("🏭 프레스")).toBeInTheDocument()
    expect(screen.getByText("🏭 CNC")).toBeInTheDocument()
    expect(screen.queryByText("AMR")).not.toBeInTheDocument()
  })
})

describe("RuleEditorPanel — A: drag machine onto new-rule draft zone", () => {
  it("shows a target badge after dropping a machine chip onto the draft zone", () => {
    render(<RuleEditorPanel />)
    const chip = screen.getByText("🏭 프레스")
    const dropzone = screen.getByTestId("rule-draft-dropzone")
    const dataTransfer = makeDataTransfer({ "application/x-sdf-machine": JSON.stringify({ machineId: "M1", label: "프레스" }) })

    fireEvent.dragStart(chip, { dataTransfer })
    fireEvent.dragOver(dropzone, { dataTransfer })
    fireEvent.drop(dropzone, { dataTransfer })

    expect(screen.getByText("대상: 프레스")).toBeInTheDocument()
  })

  it("creates the rule with the dropped machineId instead of null", () => {
    render(<RuleEditorPanel />)
    const chip = screen.getByText("🏭 프레스")
    const dropzone = screen.getByTestId("rule-draft-dropzone")
    const dataTransfer = makeDataTransfer({ "application/x-sdf-machine": JSON.stringify({ machineId: "M1", label: "프레스" }) })

    fireEvent.dragStart(chip, { dataTransfer })
    fireEvent.dragOver(dropzone, { dataTransfer })
    fireEvent.drop(dropzone, { dataTransfer })

    fireEvent.change(screen.getByPlaceholderText("룰 이름 (e.g. 고온 경보)"), { target: { value: "고온 경보" } })
    // 이 시점(Task 4)엔 조건 입력이 아직 Task 6 이전의 평범한 텍스트 input이라 직접 채워야 한다
    fireEvent.change(screen.getByPlaceholderText("temperature > 100"), { target: { value: "temperature > 100" } })
    fireEvent.click(screen.getByText("룰 추가"))

    expect(useFactoryStore.getState().rules[0].machineId).toBe("M1")
  })

  it("clears the target back to null (전체 대상) when the badge's clear button is clicked", () => {
    render(<RuleEditorPanel />)
    const chip = screen.getByText("🏭 프레스")
    const dropzone = screen.getByTestId("rule-draft-dropzone")
    const dataTransfer = makeDataTransfer({ "application/x-sdf-machine": JSON.stringify({ machineId: "M1", label: "프레스" }) })
    fireEvent.dragStart(chip, { dataTransfer })
    fireEvent.dragOver(dropzone, { dataTransfer })
    fireEvent.drop(dropzone, { dataTransfer })

    fireEvent.click(screen.getByTestId("rule-draft-target-clear"))

    expect(screen.queryByText("대상: 프레스")).not.toBeInTheDocument()
  })

  it("ignores a drop with an unrelated dataTransfer type", () => {
    render(<RuleEditorPanel />)
    const dropzone = screen.getByTestId("rule-draft-dropzone")
    const dataTransfer = makeDataTransfer({ "text/plain": "not a machine" })

    fireEvent.dragOver(dropzone, { dataTransfer })
    fireEvent.drop(dropzone, { dataTransfer })

    expect(screen.queryByText(/대상:/)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `cd apps/host-twin && npx vitest run __tests__/RuleEditorPanel.test.tsx`
Expected: FAIL — 머신 칩 목록, 드롭존(`data-testid="rule-draft-dropzone"`), 배지가 아직 없음

- [ ] **Step 3: `RuleEditorPanel.tsx`에 드래그 페이로드 타입과 머신 목록 상태 추가**

파일 상단 import를 다음으로 교체한다:

```tsx
import { useState, type DragEvent } from "react"
import { useFactoryStore } from "@/store/factoryStore"
import { validateFormula, listAvailableVariables } from "@sdf/core-sdk"
import type { RuleAction, RuleActionType } from "@sdf/types"

const MACHINE_DRAG_TYPE = "application/x-sdf-machine"
const RULE_DRAG_TYPE = "application/x-sdf-rule"
```

`export function RuleEditorPanel() {` 안, 기존 `const rules = ...` 위에 추가:

```tsx
const placedEntities = useFactoryStore((s) => s.placedEntities)
const computedMetrics = useFactoryStore((s) => s.computedMetrics)
const machines = placedEntities.filter((e) => e.type !== "robot")
```

기존 로컬 상태 선언들 다음에 추가:

```tsx
const [draftMachineId, setDraftMachineId] = useState<string | null>(null)
const [draftDropActive, setDraftDropActive] = useState(false)
```

- [ ] **Step 4: 드래그 핸들러 + 머신 칩 목록 UI 추가**

`return (` 블록의 최상단 `<p>` 라벨 바로 다음, "기존 룰 목록" 블록 이전에 머신 칩 목록을 추가한다:

```tsx
<div className="flex flex-wrap gap-1">
  {machines.map((m) => (
    <div
      key={m.id}
      draggable
      onDragStart={(e: DragEvent<HTMLDivElement>) => {
        e.dataTransfer.setData(MACHINE_DRAG_TYPE, JSON.stringify({ machineId: m.id, label: m.label }))
        e.dataTransfer.effectAllowed = "copy"
      }}
      className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-300 border border-gray-700 cursor-grab active:cursor-grabbing"
    >
      🏭 {m.label}
    </div>
  ))}
</div>
```

신규 룰 추가 폼(`<div className="bg-gray-800/60 rounded-lg p-2 space-y-1.5">`) 내부, 이름 입력(`<input value={name} ...>`) 바로 다음에 드롭존을 추가한다:

```tsx
<div
  data-testid="rule-draft-dropzone"
  onDragOver={(e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(MACHINE_DRAG_TYPE)) return
    e.preventDefault()
    setDraftDropActive(true)
  }}
  onDragLeave={() => setDraftDropActive(false)}
  onDrop={(e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(MACHINE_DRAG_TYPE)) return
    e.preventDefault()
    setDraftDropActive(false)
    const raw = e.dataTransfer.getData(MACHINE_DRAG_TYPE)
    if (!raw) return
    const { machineId } = JSON.parse(raw) as { machineId: string; label: string }
    setDraftMachineId(machineId)
  }}
  className={`text-[10px] rounded px-2 py-1 border border-dashed ${
    draftDropActive ? "border-orange-500 bg-orange-950/30" : "border-gray-700 text-gray-500"
  }`}
>
  {draftMachineId ? (
    <span className="flex items-center gap-1 text-gray-300">
      대상: {machines.find((m) => m.id === draftMachineId)?.label ?? draftMachineId}
      <button
        data-testid="rule-draft-target-clear"
        onClick={() => setDraftMachineId(null)}
        className="text-gray-600 hover:text-red-400"
      >
        ✕
      </button>
    </span>
  ) : (
    "여기로 머신을 드래그하면 대상 지정 (기본: 전체)"
  )}
</div>
```

`handleAdd`에서 `machineId: null,`을 `machineId: draftMachineId,`로 바꾸고, 함수 끝의 상태 초기화에 `setDraftMachineId(null)`을 추가한다:

```tsx
const handleAdd = () => {
  if (!name.trim() || !condition.trim()) return
  addRule({
    name: name.trim(),
    condition: condition.trim(),
    machineId: draftMachineId,
    actions: buildActions(),
    cooldownMs: (parseInt(cooldownSec) || 10) * 1000,
    enabled: true,
  })
  setName("")
  setCondition("")
  setCondError(null)
  setDraftMachineId(null)
}
```

- [ ] **Step 5: 테스트 실행해서 통과 확인**

Run: `cd apps/host-twin && npx vitest run __tests__/RuleEditorPanel.test.tsx`
Expected: PASS, "A" 관련 5개 케이스 전부 통과

- [ ] **Step 6: 커밋**

```bash
git add apps/host-twin/components/RuleEditorPanel.tsx apps/host-twin/__tests__/RuleEditorPanel.test.tsx
git commit -m "feat(host-twin): drag a machine chip onto the new-rule draft to scope it"
```

---

## Task 5: 저장된 룰 → 머신 드래그 (C) + 스코프 배지

**Files:**
- Modify: `apps/host-twin/components/RuleEditorPanel.tsx`
- Modify: `apps/host-twin/__tests__/RuleEditorPanel.test.tsx`

- [ ] **Step 1: 실패하는 테스트 추가**

`apps/host-twin/__tests__/RuleEditorPanel.test.tsx` 끝에 추가한다 (먼저 `beforeEach`에 룰 하나를 시드하는 헬퍼가 필요하므로, 파일 상단 `beforeEach` 아래에 헬퍼 함수를 추가):

```tsx
function seedRule(patch: Partial<{ machineId: string | null }> = {}) {
  useFactoryStore.setState((s) => ({
    rules: [
      ...s.rules,
      {
        id: "rule-1",
        name: "고온 경보",
        condition: "temperature > 100",
        machineId: patch.machineId ?? null,
        actions: [],
        lastTriggeredAt: 0,
        cooldownMs: 10000,
        enabled: true,
      },
    ],
  }))
}
```

파일 끝에 새 `describe` 블록 추가:

```tsx
describe("RuleEditorPanel — C: drag a saved rule onto a machine chip", () => {
  it("calls updateRule with the dropped machineId", () => {
    seedRule()
    render(<RuleEditorPanel />)
    const ruleCard = screen.getByText("고온 경보")
    const chip = screen.getByText("🏭 CNC")
    const dataTransfer = makeDataTransfer({ "application/x-sdf-rule": JSON.stringify({ ruleId: "rule-1" }) })

    fireEvent.dragStart(ruleCard, { dataTransfer })
    fireEvent.dragOver(chip, { dataTransfer })
    fireEvent.drop(chip, { dataTransfer })

    expect(useFactoryStore.getState().rules[0].machineId).toBe("M2")
  })

  it("shows a scope badge on a rule card once scoped, and clears it back to null via the badge's clear button", () => {
    seedRule({ machineId: "M1" })
    render(<RuleEditorPanel />)

    expect(screen.getByText("🏭 프레스")).toBeInTheDocument()

    fireEvent.click(screen.getByTestId("rule-scope-clear-rule-1"))

    expect(useFactoryStore.getState().rules[0].machineId).toBeNull()
  })

  it("ignores a drop onto a machine chip with an unrelated dataTransfer type", () => {
    seedRule()
    render(<RuleEditorPanel />)
    const chip = screen.getByText("🏭 CNC")
    const dataTransfer = makeDataTransfer({ "application/x-sdf-machine": JSON.stringify({ machineId: "M2", label: "CNC" }) })

    fireEvent.dragOver(chip, { dataTransfer })
    fireEvent.drop(chip, { dataTransfer })

    expect(useFactoryStore.getState().rules[0].machineId).toBeNull()
  })
})
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `cd apps/host-twin && npx vitest run __tests__/RuleEditorPanel.test.tsx`
Expected: FAIL — 룰 카드가 아직 `draggable`이 아니고, 머신 칩이 아직 드롭을 받지 않고, 스코프 배지가 없음

- [ ] **Step 3: 머신 칩에 드롭 핸들러 추가**

Task 4에서 만든 머신 칩 목록의 `<div>`에 드래그오버/드롭 핸들러를 추가한다 (`draggable`/`onDragStart`는 그대로 두고 아래 세 prop을 같은 엘리먼트에 추가):

```tsx
onDragOver={(e: DragEvent<HTMLDivElement>) => {
  if (!e.dataTransfer.types.includes(RULE_DRAG_TYPE)) return
  e.preventDefault()
  setDragOverMachineId(m.id)
}}
onDragLeave={() => setDragOverMachineId(null)}
onDrop={(e: DragEvent<HTMLDivElement>) => {
  if (!e.dataTransfer.types.includes(RULE_DRAG_TYPE)) return
  e.preventDefault()
  setDragOverMachineId(null)
  const raw = e.dataTransfer.getData(RULE_DRAG_TYPE)
  if (!raw) return
  const { ruleId } = JSON.parse(raw) as { ruleId: string }
  updateRule(ruleId, { machineId: m.id })
}}
```

칩의 `className`을 드래그오버 중 하이라이트되도록 바꾼다:

```tsx
className={`text-[10px] px-1.5 py-0.5 rounded border cursor-grab active:cursor-grabbing ${
  dragOverMachineId === m.id
    ? "border-orange-500 bg-orange-950/30 text-orange-300"
    : "bg-gray-800 text-gray-300 border-gray-700"
}`}
```

`draftMachineId`/`draftDropActive` 선언 옆에 상태 추가:

```tsx
const [dragOverMachineId, setDragOverMachineId] = useState<string | null>(null)
```

- [ ] **Step 4: 룰 카드를 드래그 소스로 만들고 스코프 배지 추가**

기존 룰 목록 렌더링에서 룰 카드 `<div>`(`className={\`rounded-lg border px-2 py-1.5 text-xs ...\`}`)에 `draggable`과 `onDragStart`를 추가한다:

```tsx
<div
  key={rule.id}
  draggable
  onDragStart={(e: DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData(RULE_DRAG_TYPE, JSON.stringify({ ruleId: rule.id }))
    e.dataTransfer.effectAllowed = "copy"
  }}
  className={`rounded-lg border px-2 py-1.5 text-xs cursor-grab active:cursor-grabbing ${
    rule.enabled ? "border-orange-800/60 bg-orange-950/20" : "border-gray-700 bg-gray-900/40"
  }`}
>
```

같은 카드 안, 액션 태그들(`{rule.actions.map(...)}`) 아래에 스코프 배지를 추가한다:

```tsx
{rule.machineId && (
  <div className="pl-5 mt-1">
    <span className="inline-flex items-center gap-1 text-[9px] px-1 py-0.5 rounded bg-gray-800 text-gray-400">
      🏭 {machines.find((m) => m.id === rule.machineId)?.label ?? rule.machineId}
      <button
        data-testid={`rule-scope-clear-${rule.id}`}
        onClick={() => updateRule(rule.id, { machineId: null })}
        className="text-gray-600 hover:text-red-400"
      >
        ✕
      </button>
    </span>
  </div>
)}
```

- [ ] **Step 5: 테스트 실행해서 통과 확인**

Run: `cd apps/host-twin && npx vitest run __tests__/RuleEditorPanel.test.tsx`
Expected: PASS, 전체 케이스 통과 (Task 4 + Task 5)

- [ ] **Step 6: 커밋**

```bash
git add apps/host-twin/components/RuleEditorPanel.tsx apps/host-twin/__tests__/RuleEditorPanel.test.tsx
git commit -m "feat(host-twin): drag a saved rule onto a machine chip to rescope it"
```

---

## Task 6: 조건식 간단 모드 (변수/연산자 드롭다운)

**Files:**
- Modify: `apps/host-twin/components/RuleEditorPanel.tsx`
- Modify: `apps/host-twin/__tests__/RuleEditorPanel.test.tsx`

- [ ] **Step 1: 실패하는 테스트 추가**

`apps/host-twin/__tests__/RuleEditorPanel.test.tsx` 끝에 추가:

```tsx
describe("RuleEditorPanel — B: simple condition builder mode", () => {
  it("defaults to simple mode with 'temperature > 100' pre-assembled", () => {
    render(<RuleEditorPanel />)
    expect(screen.getByDisplayValue("temperature")).toBeInTheDocument()
    expect(screen.getByDisplayValue("100")).toBeInTheDocument()
  })

  it("updates the assembled condition string when the variable dropdown changes", () => {
    render(<RuleEditorPanel />)
    fireEvent.change(screen.getByTestId("rule-simple-var"), { target: { value: "vibration" } })
    fireEvent.change(screen.getByPlaceholderText("룰 이름 (e.g. 고온 경보)"), { target: { value: "진동 경보" } })
    fireEvent.click(screen.getByText("룰 추가"))
    expect(useFactoryStore.getState().rules[0].condition).toBe("vibration > 100")
  })

  it("updates the assembled condition string when the operator dropdown changes", () => {
    render(<RuleEditorPanel />)
    fireEvent.change(screen.getByTestId("rule-simple-op"), { target: { value: "<" } })
    fireEvent.change(screen.getByPlaceholderText("룰 이름 (e.g. 고온 경보)"), { target: { value: "저온 경보" } })
    fireEvent.click(screen.getByText("룰 추가"))
    expect(useFactoryStore.getState().rules[0].condition).toBe("temperature < 100")
  })

  it("updates the assembled condition string when the threshold input changes, preserving decimals", () => {
    render(<RuleEditorPanel />)
    fireEvent.change(screen.getByTestId("rule-simple-threshold"), { target: { value: "98.6" } })
    fireEvent.change(screen.getByPlaceholderText("룰 이름 (e.g. 고온 경보)"), { target: { value: "체온 경보" } })
    fireEvent.click(screen.getByText("룰 추가"))
    expect(useFactoryStore.getState().rules[0].condition).toBe("temperature > 98.6")
  })

  it("includes computed metric names in the variable dropdown, scoped to the current draft target", () => {
    useFactoryStore.setState({
      computedMetrics: [
        { id: "heat_index", name: "열지수", formula: "(vibration+temperature)/2", color: "#fff", machineId: null },
      ],
    })
    render(<RuleEditorPanel />)
    const select = screen.getByTestId("rule-simple-var") as HTMLSelectElement
    const optionValues = Array.from(select.options).map((o) => o.value)
    expect(optionValues).toContain("heat_index")
  })

  it("switches to text mode and shows the assembled string as an editable free-text input", () => {
    render(<RuleEditorPanel />)
    fireEvent.click(screen.getByText("텍스트"))
    expect(screen.getByDisplayValue("temperature > 100")).toBeInTheDocument()
  })

  it("switching back to simple mode resets the simple fields to defaults", () => {
    render(<RuleEditorPanel />)
    fireEvent.click(screen.getByText("텍스트"))
    fireEvent.change(screen.getByDisplayValue("temperature > 100"), { target: { value: "vibration > 5 && weird syntax" } })
    fireEvent.click(screen.getByText("간단"))
    expect(screen.getByDisplayValue("temperature")).toBeInTheDocument()
    expect(screen.getByDisplayValue("100")).toBeInTheDocument()
  })

  it("does not show 'Unknown variable' error when a computed metric is selected in the dropdown", () => {
    useFactoryStore.setState({
      computedMetrics: [
        { id: "heat_index", name: "열지수", formula: "(vibration+temperature)/2", color: "#fff", machineId: null },
      ],
    })
    render(<RuleEditorPanel />)
    fireEvent.change(screen.getByTestId("rule-simple-var"), { target: { value: "heat_index" } })
    expect(screen.queryByText(/Unknown variable/)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `cd apps/host-twin && npx vitest run __tests__/RuleEditorPanel.test.tsx`
Expected: FAIL — 간단 모드 UI(`rule-simple-var`/`rule-simple-op`/`rule-simple-threshold`, "텍스트"/"간단" 토글 버튼)가 아직 없음. 지금은 조건 필드가 빈 텍스트 입력 하나뿐.

- [ ] **Step 3: 상태 추가 및 `condition`/`handleConditionChange` 재구성**

`draftMachineId`/`draftDropActive`/`dragOverMachineId` 선언 옆에 추가:

```tsx
const COMPARISON_OPS = [">", "<", ">=", "<=", "==", "!="] as const
type ComparisonOp = (typeof COMPARISON_OPS)[number]

const availableVariables = listAvailableVariables(draftMachineId, computedMetrics)

function assembleSimpleCondition(v: string, op: string, threshold: string) {
  return `${v} ${op} ${threshold}`
}

const [conditionMode, setConditionMode] = useState<"simple" | "text">("simple")
const [simpleVar, setSimpleVar] = useState("temperature")
const [simpleOp, setSimpleOp] = useState<ComparisonOp>(">")
const [simpleThreshold, setSimpleThreshold] = useState("100")
```

기존 `const [condition, setCondition] = useState("")`를 다음으로 교체 (기본값을 간단 모드 기본 조합값으로):

```tsx
const [condition, setCondition] = useState(() => assembleSimpleCondition("temperature", ">", "100"))
```

기존 `handleConditionChange`를 다음으로 교체 — 하드코딩된 3개 대신 `availableVariables`를 검증에 넘긴다:

```tsx
const handleConditionChange = (v: string) => {
  setCondition(v)
  if (!v.trim()) { setCondError(null); return }
  const checkExpr = v.replace(/[><=!]+.*/g, "").trim() || v
  const result = validateFormula(checkExpr.trim() || "0", availableVariables)
  setCondError(result.valid ? null : (result.error ?? "유효하지 않은 조건"))
}

const handleSimpleFieldChange = (next: { v?: string; op?: ComparisonOp; t?: string }) => {
  const v = next.v ?? simpleVar
  const op = next.op ?? simpleOp
  const t = next.t ?? simpleThreshold
  if (next.v !== undefined) setSimpleVar(next.v)
  if (next.op !== undefined) setSimpleOp(next.op)
  if (next.t !== undefined) setSimpleThreshold(next.t)
  handleConditionChange(assembleSimpleCondition(v, op, t))
}

const handleModeToggle = (mode: "simple" | "text") => {
  setConditionMode(mode)
  if (mode === "simple") {
    setSimpleVar("temperature")
    setSimpleOp(">")
    setSimpleThreshold("100")
    handleConditionChange(assembleSimpleCondition("temperature", ">", "100"))
  }
}
```

`handleAdd`의 상태 초기화에 간단 모드 필드 리셋을 추가한다:

```tsx
const handleAdd = () => {
  if (!name.trim() || !condition.trim()) return
  addRule({
    name: name.trim(),
    condition: condition.trim(),
    machineId: draftMachineId,
    actions: buildActions(),
    cooldownMs: (parseInt(cooldownSec) || 10) * 1000,
    enabled: true,
  })
  setName("")
  setDraftMachineId(null)
  setConditionMode("simple")
  setSimpleVar("temperature")
  setSimpleOp(">")
  setSimpleThreshold("100")
  handleConditionChange(assembleSimpleCondition("temperature", ">", "100"))
}
```

- [ ] **Step 4: 조건 입력 UI를 모드 토글 + 간단/텍스트 두 뷰로 교체**

기존 조건 입력 블록:

```tsx
<div>
  <input
    value={condition}
    onChange={(e) => handleConditionChange(e.target.value)}
    placeholder="temperature > 100"
    className={`w-full bg-gray-900 text-xs font-mono rounded px-2 py-1 border outline-none ${
      condError ? "border-red-600 text-red-300" : "border-gray-700 text-gray-200 focus:border-orange-600"
    }`}
  />
  {condError && <p className="text-[10px] text-red-400 mt-0.5">{condError}</p>}
</div>
```

를 다음으로 교체한다:

```tsx
<div>
  <div className="flex gap-1 mb-1">
    <button
      onClick={() => handleModeToggle("simple")}
      className={`text-[10px] px-1.5 py-0.5 rounded ${conditionMode === "simple" ? "bg-orange-900/60 text-orange-300" : "bg-gray-800 text-gray-500"}`}
    >
      간단
    </button>
    <button
      onClick={() => handleModeToggle("text")}
      className={`text-[10px] px-1.5 py-0.5 rounded ${conditionMode === "text" ? "bg-orange-900/60 text-orange-300" : "bg-gray-800 text-gray-500"}`}
    >
      텍스트
    </button>
  </div>

  {conditionMode === "simple" ? (
    <div className="flex gap-1">
      <select
        data-testid="rule-simple-var"
        value={simpleVar}
        onChange={(e) => handleSimpleFieldChange({ v: e.target.value })}
        className="bg-gray-900 text-xs text-gray-200 rounded border border-gray-700 px-1 py-1"
      >
        {availableVariables.map((v) => (
          <option key={v} value={v}>{v}</option>
        ))}
      </select>
      <select
        data-testid="rule-simple-op"
        value={simpleOp}
        onChange={(e) => handleSimpleFieldChange({ op: e.target.value as ComparisonOp })}
        className="bg-gray-900 text-xs text-gray-200 rounded border border-gray-700 px-1 py-1"
      >
        {COMPARISON_OPS.map((op) => (
          <option key={op} value={op}>{op}</option>
        ))}
      </select>
      <input
        data-testid="rule-simple-threshold"
        value={simpleThreshold}
        onChange={(e) => handleSimpleFieldChange({ t: e.target.value })}
        className="flex-1 min-w-0 bg-gray-900 text-xs font-mono text-gray-200 rounded px-2 py-1 border border-gray-700 outline-none focus:border-orange-600"
      />
    </div>
  ) : (
    <input
      value={condition}
      onChange={(e) => handleConditionChange(e.target.value)}
      placeholder="temperature > 100"
      className={`w-full bg-gray-900 text-xs font-mono rounded px-2 py-1 border outline-none ${
        condError ? "border-red-600 text-red-300" : "border-gray-700 text-gray-200 focus:border-orange-600"
      }`}
    />
  )}
  {condError && <p className="text-[10px] text-red-400 mt-0.5">{condError}</p>}
</div>
```

- [ ] **Step 5: 테스트 실행해서 통과 확인**

Run: `cd apps/host-twin && npx vitest run __tests__/RuleEditorPanel.test.tsx`
Expected: PASS, 전체 케이스(Task 4/5/6 전부) 통과

- [ ] **Step 6: 커밋**

```bash
git add apps/host-twin/components/RuleEditorPanel.tsx apps/host-twin/__tests__/RuleEditorPanel.test.tsx
git commit -m "feat(host-twin): add simple variable/operator condition builder mode"
```

---

## Task 7: 전체 검증 + 로드맵 문서 갱신

**Files:**
- Modify: `docs/superpowers/specs/2026-07-22-plugin-platform-roadmap-v2.md`

- [ ] **Step 1: 프런트엔드 전체 typecheck**

Run: `pnpm -w typecheck`
Expected: 5개 패키지(`@sdf/types`, `@sdf/core-sdk`, `@sdf/plugin-runtime`, `@sdf/ui`, `apps/host-twin`) 전부 에러 없음

- [ ] **Step 2: 프런트엔드 전체 테스트**

Run: `pnpm -w test`
Expected: 기존 테스트 + 이번에 추가한 `formulaEngine.test.ts`/`FormulaEditor.test.tsx`/`RuleEditorPanel.test.tsx` 케이스 전부 통과, 실패/스킵 없음

- [ ] **Step 3: 빌드**

Run: `pnpm -w build`
Expected: 에러 없이 빌드 완료

- [ ] **Step 4: 백엔드 회귀 확인 (변경 없음 재확인)**

Run: `cd apps/backend-sim && .venv/Scripts/python.exe -m pytest`
Expected: 기존 테스트 수 그대로 전부 통과 — 이번 Phase가 `apps/backend-sim` 파일을 하나도 건드리지 않았음을 재확인

- [ ] **Step 5: 로드맵 문서에 5b 구현 완료 반영**

`docs/superpowers/specs/2026-07-22-plugin-platform-roadmap-v2.md`의 Phase 5 섹션 상태 줄(`**상태 (5a 완료, 5b 설계 완료):**`)을 `**상태 (5a, 5b 모두 완료):**`로 바꾸고, "5b 실제 설계" 문단 제목을 "5b 실제 구현"으로 바꾼다. 구현 계획 문서 경로(`2026-07-29-plugin-platform-phase5b-rule-editor-drag-implementation.md`)도 참조로 추가한다.

- [ ] **Step 6: 커밋**

```bash
git add docs/superpowers/specs/2026-07-22-plugin-platform-roadmap-v2.md
git commit -m "docs: mark Phase 5b (rule editor drag interaction) complete in roadmap"
```

---

## 참고 — 기존 워크트리

`.claude/worktrees/plugin-platform-phase5b`가 이미 존재하지만(브랜치 `worktree-plugin-platform-phase5b`) `main`의 이전 커밋(`73d0218`, 이번 Phase의 설계 문서 커밋 `8d578e8` 이전)에서 멈춰 있다. 이 계획을 실행할 워크트리로 재사용하려면 실행 시작 전에 **반드시 `main`을 최신으로 병합/리베이스**해야 한다 — Phase 7 때 겪었던 "워크트리가 오래된 base에서 갈라져서 설계 문서가 안 보이는" 문제의 재발을 막기 위함이다(로드맵 문서 Phase 7 섹션의 "워크트리 노트" 참조).
