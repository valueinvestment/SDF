# Frontend Development Skill
# Headless + Styled 컴포넌트 패턴

이 프로젝트의 프론트엔드 컴포넌트는 **로직(Headless)** 과 **시각화(Styled)** 를 분리하여 작성합니다. 재사용성을 높이고, OSS로 배포하거나 다른 디자인 시스템에 이식할 수 있도록 하기 위함입니다.

---

## 패턴 개요

```
┌─────────────────────────────────────────────────────────┐
│                   Styled Layer (시각화)                   │
│  Tailwind CSS + HeadlessUI 프리미티브                     │
│  - 색상, 간격, 타이포그래피                                │
│  - 애니메이션, 반응형 레이아웃                              │
│  - 아이콘, 배지, 상태 표시                                  │
└────────────────────────┬────────────────────────────────┘
                         │ props (data + callbacks)
┌────────────────────────▼────────────────────────────────┐
│                   Headless Layer (로직)                   │
│  React Hook or Renderless Component                      │
│  - 상태 관리 (open/closed, selected, loading)             │
│  - 접근성 (ARIA, 키보드 내비게이션)                         │
│  - 비즈니스 로직 (제한 검사, ID 생성, 콜백)                 │
│  - 외부 의존성 (Zustand store, WebSocket)                 │
└─────────────────────────────────────────────────────────┘
```

---

## 핵심 원칙

### 1. 로직은 Hook으로, 시각화는 컴포넌트로

**나쁜 예 — 로직과 시각화가 뒤섞임:**
```tsx
export function AddEntityModal({ onClose }: Props) {
  const placedEntities = useFactoryStore((s) => s.placedEntities)
  const countOf = (type: EntityType) =>
    placedEntities.filter((e) => e.type === type).length

  // 로직과 JSX가 한 파일에 혼재
  return (
    <div className="fixed inset-0 bg-black/60">
      {TYPE_META.map(({ type, korLabel }) => (
        <button disabled={countOf(type) >= 5} onClick={() => handleSelect(type)}>
          {korLabel} — {countOf(type)} / 5
        </button>
      ))}
    </div>
  )
}
```

**좋은 예 — 분리된 구조:**
```tsx
// useAddEntityModal.ts — 로직만, JSX 없음
export function useAddEntityModal() {
  const placedEntities = useFactoryStore((s) => s.placedEntities)
  const enterPlacementMode = useFactoryStore((s) => s.enterPlacementMode)

  const countOf = (type: EntityType) =>
    placedEntities.filter((e) => e.type === type).length

  const canAdd = (type: EntityType) => countOf(type) < MAX_PER_TYPE

  const select = (type: EntityType, onClose: () => void) => {
    if (!canAdd(type)) return
    const count = countOf(type)
    const meta = TYPE_META.find((m) => m.type === type)!
    enterPlacementMode(type, `${type}-${Date.now()}`, `${meta.korLabel} #${count + 1}`)
    onClose()
  }

  return { countOf, canAdd, select, typeMeta: TYPE_META }
}

// AddEntityModal.tsx — 시각화만, 비즈니스 로직 없음
export function AddEntityModal({ onClose }: Props) {
  const { countOf, canAdd, select } = useAddEntityModal()

  return (
    <Dialog open onClose={onClose}>  {/* HeadlessUI Dialog */}
      <Dialog.Panel className="bg-gray-900 rounded-2xl p-6 w-80">
        <div className="grid grid-cols-2 gap-3">
          {TYPE_META.map(({ type, icon, korLabel }) => (
            <button
              key={type}
              disabled={!canAdd(type)}
              onClick={() => select(type, onClose)}
              className={!canAdd(type) ? "opacity-40 cursor-not-allowed" : "hover:border-blue-500"}
            >
              <span>{icon}</span>
              <span>{korLabel}</span>
              <span>{countOf(type)} / {MAX_PER_TYPE}</span>
            </button>
          ))}
        </div>
      </Dialog.Panel>
    </Dialog>
  )
}
```

---

### 2. HeadlessUI 프리미티브 활용

[HeadlessUI](https://headlessui.com/)는 접근성(ARIA)과 키보드 내비게이션을 제공하되 스타일을 강요하지 않습니다. 이 프로젝트에서 다음 프리미티브를 우선 사용합니다.

| 컴포넌트 | 사용처 |
|---|---|
| `Dialog` | AddEntityModal, 확인 다이얼로그 |
| `Combobox` | 필터링 가능한 드롭다운 |
| `Listbox` | 단순 셀렉트 |
| `Switch` | 토글 (테마, 설정) |
| `Disclosure` | 접을 수 있는 섹션 |
| `Tab` | 탭 패널 |

```tsx
import { Dialog } from "@headlessui/react"

// Dialog는 ESC 키, 백드롭 클릭, 포커스 트랩을 자동 처리
<Dialog open={isOpen} onClose={onClose}>
  <div className="fixed inset-0 bg-black/60" aria-hidden="true" />
  <div className="fixed inset-0 flex items-center justify-center">
    <Dialog.Panel className="bg-gray-900 rounded-2xl p-6">
      <Dialog.Title className="text-white font-semibold">장비 추가</Dialog.Title>
      {/* 내용 */}
    </Dialog.Panel>
  </div>
</Dialog>
```

---

### 3. Props API 설계 — OSS 배포 기준

외부 소비자가 이 컴포넌트를 사용할 수 있도록 Props를 설계합니다.

**규칙:**
- 컴포넌트는 자신의 데이터를 직접 fetching하지 않음 — 항상 props로 받음
- 콜백은 `on`으로 시작 (`onClose`, `onSelect`, `onChange`)
- 내부 스타일 덮어쓰기를 위한 `className` prop 허용
- `children` 또는 render prop으로 시각화 커스터마이징 가능

```tsx
// OSS 배포를 위한 Props 설계
interface EntityCardProps {
  type: string
  label: string
  icon: string
  count: number
  max: number
  onSelect: () => void
  // 소비자가 스타일 확장 가능
  className?: string
  // 소비자가 배지 렌더링 커스터마이징 가능
  renderBadge?: (count: number, max: number) => React.ReactNode
}

export function EntityCard({
  type, label, icon, count, max, onSelect,
  className = "",
  renderBadge,
}: EntityCardProps) {
  const disabled = count >= max
  return (
    <button
      disabled={disabled}
      onClick={onSelect}
      className={`rounded-xl p-4 border transition-colors ${
        disabled ? "opacity-40 cursor-not-allowed" : "hover:border-blue-500"
      } ${className}`}
    >
      <span>{icon}</span>
      <span>{label}</span>
      {renderBadge
        ? renderBadge(count, max)
        : <span className="text-xs text-gray-400">{count} / {max}</span>
      }
    </button>
  )
}
```

---

### 4. 파일 구조 컨벤션

```
components/
├── AddEntityModal.tsx        ← Styled: HeadlessUI Dialog + Tailwind
├── EntityCard.tsx            ← Styled: 재사용 가능한 타입 카드
├── Palette.tsx               ← Styled: 사이드바 레이아웃
└── MachineDetailPanel.tsx    ← Styled: 상세 패널 레이아웃

hooks/
├── useAddEntityModal.ts      ← Headless: 모달 상태 + 비즈니스 로직
├── usePalette.ts             ← Headless: 팔레트 아이템 목록 + 선택 로직
└── useMachineDetail.ts       ← Headless: 상세 데이터 구독 + 포매팅
```

---

### 5. 재사용성 체크리스트

컴포넌트를 작성하거나 리뷰할 때 다음 질문에 답할 수 있어야 합니다.

- [ ] **Storybook에서 렌더링 가능한가?** WebSocket 없이, store 없이 props만으로 렌더링되면 분리가 잘 된 것
- [ ] **다른 디자인 시스템에 이식 가능한가?** Tailwind 클래스를 제거해도 로직은 작동해야 함
- [ ] **소비자가 시각화를 바꿀 수 있는가?** `className` 또는 render prop이 제공되어야 함
- [ ] **접근성 속성이 있는가?** `aria-label`, `role`, 키보드 내비게이션 (HeadlessUI가 자동 처리)
- [ ] **타입이 완전한가?** Props 인터페이스에 JSDoc 없어도 타입만으로 사용법이 명확해야 함

---

## OSS 배포 준비

이 패턴으로 작성된 컴포넌트는 다음 절차로 독립 패키지로 배포할 수 있습니다.

### 패키지 구조
```
@sdf/ui/
├── src/
│   ├── components/     ← Styled 컴포넌트 (HeadlessUI + Tailwind)
│   ├── hooks/          ← Headless 훅 (순수 로직)
│   └── index.ts        ← 공개 API
├── package.json
└── tsconfig.json
```

### 공개 API 원칙
```ts
// index.ts — Headless와 Styled를 모두 export
// 소비자가 원하는 레이어만 사용 가능

// Headless만 사용 (자체 UI 구현 시)
export { useAddEntityModal } from "./hooks/useAddEntityModal"
export { usePalette } from "./hooks/usePalette"

// Styled 컴포넌트 사용 (Tailwind 환경에서 바로 사용 시)
export { AddEntityModal } from "./components/AddEntityModal"
export { Palette } from "./components/Palette"
export { EntityCard } from "./components/EntityCard"

// 타입 export
export type { EntityType, PlacedEntity } from "./types"
```

### Tailwind 설정 주의사항
Styled 컴포넌트를 npm 패키지로 배포할 때, 소비자의 Tailwind가 패키지 내부 클래스를 퍼지하지 않도록 `content` 경로를 안내합니다.

```js
// 소비자의 tailwind.config.js
module.exports = {
  content: [
    "./src/**/*.{ts,tsx}",
    "./node_modules/@sdf/ui/src/**/*.{ts,tsx}",  // 패키지 내부 클래스 포함
  ],
}
```

---

## 현재 적용 현황

| 컴포넌트 | Headless 분리 | HeadlessUI 사용 | OSS Ready |
|---|---|---|---|
| `AddEntityModal` | ✅ `useAddEntityModal` hook | ✅ HeadlessUI Dialog | ✅ |
| `Palette` | ⬜ 로직이 컴포넌트 내부에 있음 | ⬜ 미적용 | ⬜ |
| `MachineDetailPanel` | ⬜ ECharts 로직이 혼재 | ⬜ 미적용 | ⬜ |
| `SensorChart` | ⬜ ECharts 로직이 혼재 | ⬜ 미적용 | ⬜ |

> 리팩터링 순서: `AddEntityModal` → `Palette` → `MachineDetailPanel` → `SensorChart`
> 각 단계마다 Storybook으로 시각적 회귀 확인.
