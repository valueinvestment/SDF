# Phase 5b — 룰 에디터 드래그 인터랙션 확장 (설계)

**상태:** 브레인스토밍 완료, 설계 확정. 로드맵 문서 `2026-07-22-plugin-platform-roadmap-v2.md`의 Phase 5(§"WebSocket 스트림 모킹 데모 모드 + 플러그인 확장") 중 5a(데모 모드, 완료)와 분리된 나머지 절반.

## 배경

로드맵 원안은 "드래그 인터랙션으로 룰을 정의하는 UI(기존 `RuleEditorPanel` 확장)"라고만 적혀 있고 구체안이 없었다. 브레인스토밍으로 4가지 후보를 목업까지 만들어 검토한 결과, 두 개(머신↔룰 스코핑)를 채택하고 하나(조건식 콤보박스)는 축소된 형태로 병행 채택, 하나(액션 순서 재정렬)는 제외했다.

기존 `RuleEditorPanel.tsx`는 완전히 텍스트 폼이다 — 룰 이름, 조건식(`temperature > 100` 같은 자유 문자열), 액션 체크박스만 있다. `Rule.machineId: string | null` 필드는 타입과 `useRuleEngine.ts`의 평가 로직엔 이미 존재하지만(`r.machineId === null || r.machineId === machineId`), UI가 이를 설정할 방법이 없어 `handleAdd`가 항상 `machineId: null`(전체 머신 대상)로 룰을 생성한다. 이번 Phase가 채우는 건 정확히 이 UI 공백이다.

## 스코프

**포함:**
1. 머신 → 새 룰 폼 드래그로 룰 생성 시점에 대상 머신 지정 ("A")
2. 이미 저장된 룰 → 머신 드래그로 사후에 대상 머신 재지정 ("C")
3. 조건식 입력의 "간단 모드"(변수/비교연산자 드롭다운 + 숫자 입력) — 기존 텍스트 모드와 병행 ("B", 축소판)
4. 위 3번을 만들다 발견한 기존 버그 수정: `validateFormula`가 커스텀 지표(computed metric) 이름을 항상 "Unknown variable"로 잘못 거부하는 문제

**제외 (브레인스토밍 중 명시적으로 뺀 것들):**
- 액션 카드 드래그로 실행 순서 재정렬 — 실효성 낮음, 아무도 선택 안 함
- 하나의 룰을 여러 머신에 동시 스코프(`machineId: string[]`) — 기존 단일-머신-또는-전체 모델 유지. 여러 머신에 같은 룰이 필요하면 룰을 복사해서 각각 드래그
- 조건식에서 여러 변수를 `+-*/`로 조합하는 복합 빌더 — 이미 텍스트 모드로 가능하고 `ComputedMetric`과 역할이 겹침
- 센서 값 단위 변환 — 로드맵 문서 백로그 "센서 값 단위 변환 + 단위 인식 커스텀 지표"로 이관
- 백엔드가 새 센서 변수를 도입해도 자동 반영되는 가변 스키마 — 로드맵 문서 백로그 "MachineState 가변 센서 변수 지원"으로 이관. 이번 Phase는 이 백로그가 나중에 착수될 때 변경 지점이 한 곳으로 모이도록만 설계한다(아래 "확장 지점" 참조).

## 아키텍처

### 드래그 구현 방식

네이티브 HTML5 Drag and Drop API(`draggable`, `onDragStart`, `onDragOver`, `onDrop`, `dataTransfer`)를 쓴다. 신규 런타임 의존성 없음 — Phase 3a의 `create-plugin` 스크립트가 "새 의존성 없음"을 명시적으로 택한 것과 같은 방향. 이 앱은 데스크탑 전용 관리자 대시보드라 터치 드래그 미지원은 실질적 손해가 아니다.

두 가지 드래그 payload 타입을 커스텀 MIME으로 구분한다:
- `application/x-sdf-machine` → `{ machineId: string, label: string }`
- `application/x-sdf-rule` → `{ ruleId: string }`

모든 `onDrop` 핸들러는 처리 전에 `event.dataTransfer.types`가 기대하는 타입을 포함하는지 먼저 확인하고, 아니면 조용히 무시한다(브라우저 파일 드롭 등 무관한 드래그가 오작동하지 않도록).

### 새 "머신 목록" 섹션 (드래그 소스 겸 드롭 타겟)

`RuleEditorPanel`이 `factoryStore.placedEntities`를 직접 구독해서 `e.type !== "robot"`으로 필터링한다 — `app/page.tsx`가 이미 쓰는 `placedMachines` 필터와 동일한 규칙이라 두 곳의 "머신이란 무엇인가" 정의가 어긋나지 않는다. 패널 상단에 머신 칩 목록으로 렌더링하며, 각 칩은:
- `draggable`이고 `dragstart` 시 `application/x-sdf-machine` payload를 싣는다 (A의 드래그 소스)
- `dragover`/`drop` 핸들러도 갖고 있어서 `application/x-sdf-rule` payload를 받으면 반응한다 (C의 드롭 타겟)

### A — 머신 → 신규 룰 폼

신규 룰 추가 폼에 드롭존을 추가한다. 머신 칩을 드롭하면 새 로컬 상태 `draftMachineId: string | null`이 설정되고 폼에 "대상: 🏭 M1 ✕" 배지로 표시된다(✕ 클릭 시 `null`로 리셋 = 전체 대상, 기존 동작과 동일). `handleAdd`는 하드코딩된 `machineId: null` 대신 `draftMachineId`를 사용한다.

### C — 저장된 룰 → 머신

기존 룰 목록의 각 룰 카드도 `draggable`이 되어(`application/x-sdf-rule` payload) 머신 칩 위에 드롭하면 그 자리에서 바로 `updateRule(ruleId, { machineId })`를 호출한다 — 별도 저장 버튼 없이 즉시 반영. 이미 스코프된 룰 카드에는 배지가 표시되고, 배지의 ✕는 `updateRule(ruleId, { machineId: null })`로 되돌린다.

**타입 변경 없음** — `Rule.machineId: string | null`은 이미 이 용도로 설계돼 있었다. `useRuleEngine.ts`, 백엔드는 전혀 건드리지 않는다.

### B — 조건식 간단 모드

`RuleEditorPanel`에 로컬 상태 `conditionMode: "simple" | "text"` 추가(기본값 `"simple"`). 간단 모드는 세 필드를 조합한다:

```
[변수 드롭다운] [비교연산자 드롭다운: > < >= <= == !=] [숫자 입력]
```

이 세 값을 조합해 기존 `condition` 문자열 그대로 만든다(예: `temperature > 100`) — `Rule.condition`의 타입도 `formulaEngine`도 바뀌지 않는다. 텍스트 모드는 지금 그대로(자유 수식, `abs/min/max/sqrt` 포함) — 이미 `(vibration + temperature) / 2 > 100` 같은 복합식이 가능하므로 새로 만들 필요가 없다.

모드를 전환해도 서로 파싱해서 동기화하지 않는다(왕복 파싱은 복잡도 대비 이득이 적음): 간단→텍스트는 조합된 문자열을 그대로 텍스트 입력에 보여주고 편집 가능하게 두고, 텍스트→간단은 간단 모드 필드를 초기화(빈 값)한다.

## 확장 지점 — `validateFormula` 버그 수정 + 변수 목록 단일화

간단 모드의 변수 드롭다운에 무엇을 넣을지 정하다가 기존 버그를 발견했다: `packages/core-sdk/src/formulaEngine.ts`의 `validateFormula(formula)`는 인자 없이 내부에 `{ vibration: 1, temperature: 1, current: 1 }`을 하드코딩해서 검증한다. 즉 조건식이나 지표 수식이 커스텀 지표(`ComputedMetric`) 이름을 참조하면 — 런타임(`useRuleEngine.ts`, 이미 `computedMetrics`를 `vars`에 누적해 넣는다)에서는 정상 평가되지만, 입력 시점 검증에서는 항상 "Unknown variable"로 잘못 거부된다. `FormulaEditor.tsx`도 같은 함수를 쓰므로 지표 수식이 다른 지표를 참조하는 경우도 이미 깨져 있었다. 이번 Phase의 변수 드롭다운이 정확히 이 경로를 정면으로 사용하게 되므로 같이 고친다.

**변경:**

1. `packages/types/src/index.ts`에 상수 추가:
   ```ts
   export const BASE_RULE_VARIABLES: readonly string[] = ["vibration", "temperature", "current"]
   ```
   기존에 4곳(`formulaEngine.validateFormula` 내부, `useRuleEngine.ts`의 `vars` 구성, `FormulaEditor.tsx`의 힌트 문구, 이번에 새로 만드는 드롭다운)에 흩어져 있던 동일 리터럴을 이 상수 하나로 모은다.

2. `packages/core-sdk/src/formulaEngine.ts`에 함수 추가:
   ```ts
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
   필터 규칙은 `FormulaEditor.tsx`가 이미 쓰는 규칙, 그리고 `useRuleEngine.ts`가 런타임에 `vars`를 채울 때 쓰는 규칙과 동일하다 — 세 곳의 "이 머신에서 어떤 변수를 쓸 수 있는가" 정의가 이제 한 함수로 통일된다.

3. `validateFormula`의 시그니처를 확장(기본값이 있어 기존 호출부는 무변경으로 동작):
   ```ts
   export function validateFormula(
     formula: string,
     extraVariableNames: readonly string[] = [],
   ): { valid: boolean; error?: string }
   ```
   `RuleEditorPanel`과 `FormulaEditor` 양쪽 모두 `validateFormula(str, listAvailableVariables(...))` 형태로 호출하도록 고친다.

**나중에 "MachineState 가변 센서 변수 지원" 백로그가 착수될 때**: `BASE_RULE_VARIABLES`(또는 `listAvailableVariables`의 베이스 목록 부분)만 정적 배열에서 실제 머신 상태 기반 동적 목록으로 바꾸면 되고, 드롭다운 렌더링 코드·검증 호출부·힌트 문구는 손댈 필요가 없다. 지금은 백엔드/`MachineState` 스키마를 전혀 건드리지 않는다(YAGNI) — 변경 지점을 한 곳으로 모아두는 선에서 그친다.

## 상태/타입 변경 요약

- `Rule`/`RuleAction`/`MachineState` 타입: **변경 없음**
- `factoryStore`의 `addRule`/`updateRule`: **변경 없음** (이미 `machineId`를 받는다)
- `useRuleEngine.ts`: **변경 없음**
- 백엔드(`apps/backend-sim`): **변경 없음**
- 새로 추가: `packages/types`의 `BASE_RULE_VARIABLES` 상수, `packages/core-sdk`의 `listAvailableVariables` 함수 + `validateFormula` 시그니처 확장
- `RuleEditorPanel.tsx` 로컬 상태 추가: `draftMachineId`, `conditionMode`, `simpleVar`/`simpleOp`/`simpleThreshold`, 드래그오버 시각 피드백용 상태
- `FormulaEditor.tsx`: `validateFormula` 호출부와 힌트 문구를 `listAvailableVariables` 기반으로 수정

이 Phase는 프런트엔드 두 컴포넌트 파일(+테스트) 스코프이고, `packages/types`/`packages/core-sdk`에 작은 공유 유틸 추가가 전부다.

## 에러 처리

- 무관한 `dataTransfer` 타입의 드롭은 무시 (위 "드래그 구현 방식" 참조)
- 간단 모드의 숫자 입력(`simpleThreshold`)은 `cooldownSec`/`soundFreq`처럼 JS 숫자로 파싱하지 않는다 — 조합된 조건 문자열(`temperature > 98.6`)에 그대로 문자열로 끼워 넣고, 실제 숫자 파싱은 (기존과 동일하게) `formulaEngine`의 토크나이저가 조건을 평가할 때 담당한다. 그래서 `parseInt`로 정수 자르는 버그가 애초에 생길 여지가 없다 — 잘못된 입력(예: 빈 값, 문자)은 조합된 문자열이 `validateFormula`를 통과하지 못해 기존 에러 UI로 자연스럽게 걸러진다
- 조합된 조건 문자열은 (수정된) `validateFormula` 파이프라인을 그대로 통과시켜 기존 빨간 테두리 에러 UI 재사용
- 여러 룰이 같은 머신에 스코프되는 것은 충돌이 아니다 — `useRuleEngine.ts`의 `relevantRules` 필터는 이미 다대다를 지원

## 테스트 계획

RTL로 `dragstart`/`dragover`/`drop` 이벤트를 수동으로 구성한 `dataTransfer` mock 객체로 시뮬레이션한다(jsdom의 네이티브 `DataTransfer` 구현이 불완전하므로 우회).

- 머신 칩 → 드래프트 드롭존: `draftMachineId` 반영, 배지 표시, `addRule` 호출 시 포함
- 배지 ✕: `draftMachineId`를 `null`로 리셋
- 룰 카드 → 머신 칩: `updateRule(ruleId, { machineId })` 호출
- 스코프된 룰 카드의 배지 ✕: `updateRule(ruleId, { machineId: null })` 호출
- 무관한 `dataTransfer` 타입의 드롭: 아무 상태도 변경되지 않음
- 간단 모드: 변수/연산자/숫자 조합이 올바른 조건 문자열을 만드는지
- 간단 모드 변수 드롭다운: `listAvailableVariables`가 스코프(`draftMachineId`)에 맞는 computed metric만 포함하는지
- `listAvailableVariables` 단위 테스트: 전역(`machineId: null`) 지표와 특정 머신 지표 필터링
- `validateFormula` 단위 테스트: `extraVariableNames`로 넘긴 이름이 더 이상 "Unknown variable"로 거부되지 않는지 (회귀 테스트 — 버그 수정 확인)
- `FormulaEditor.tsx`: 다른 지표 이름을 참조하는 수식이 더 이상 거부되지 않는지

백엔드 테스트는 없음(변경 없음).

## 의존관계

Phase 0의 패널 계약에 의존(기존과 동일, 이번 Phase가 새로 추가하는 의존성 없음). Phase 5a(데모 모드)와는 독립적 — 같은 `RuleEditorPanel.tsx`을 건드리지 않으므로 병합 순서 무관.
