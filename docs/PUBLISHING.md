# NPM 배포 & 플러그인 컴포넌트 표준 규격 가이드

SDF 디지털 트윈 플랫폼은 pnpm 워크스페이스 + Turborepo 모노레포로 구성되며,
재사용 가능한 코어를 `packages/` 하위의 독립 NPM 패키지로 배포한다.
외부 개발자는 이 패키지들을 설치하여 자체 대시보드를 구성하거나 플러그인을 작성할 수 있다.

---

## 1. 모노레포 패키지 구성

| 패키지 | 역할 | 의존성 | 비고 |
|---|---|---|---|
| `@sdf/types` | 공유 TypeScript 타입 (PlacedEntity, DashboardConfig, Rule, LayoutPanel 등) | 없음 | 모든 패키지의 기반 |
| `@sdf/core-sdk` | 헤드리스 로직 — 수식 평가기(formulaEngine), 시뮬레이터, 가우시안 노이즈 | `@sdf/types` | UI/React 비의존 |
| `@sdf/ui` | Styled 컴포넌트 — `DashboardErrorBoundary` 등 | `@sdf/types`, react(peer) | Tailwind 기반 |

```
packages/
├── types/      → @sdf/types
├── core-sdk/   → @sdf/core-sdk   (exports: ".", "./formula", "./simulator")
└── ui/         → @sdf/ui
```

워크스페이스 내부 참조는 `"@sdf/types": "workspace:*"` 프로토콜을 사용한다.
`pnpm publish` 시 `workspace:*`는 배포 버전(예: `^0.1.0`)으로 자동 치환된다.

---

## 2. 배포 전 준비

현재 패키지는 모두 `"private": true` 이며 `main`/`types`가 소스 `.ts`를 직접 가리킨다
(워크스페이스 내부 소비 전용). NPM 공개 배포 시 다음을 적용한다.

### 2.1 빌드 산출물 생성

소스 `.ts`를 그대로 배포하면 외부 소비자의 번들러가 트랜스파일을 강요받는다.
`tsup`으로 ESM + CJS + `.d.ts`를 생성한다.

```jsonc
// packages/<pkg>/package.json
{
  "private": false,
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "files": ["dist"],
  "sideEffects": false,
  "scripts": {
    "build": "tsup src/index.ts --format esm,cjs --dts --clean",
    "typecheck": "tsc --noEmit"
  },
  "publishConfig": { "access": "public" }
}
```

> `@sdf/core-sdk`는 서브패스(`./formula`, `./simulator`)도 export하므로
> `tsup src/index.ts src/formulaEngine.ts src/simulator.ts ...`로 엔트리를 모두 지정한다.

### 2.2 turbo.json — build 산출물 캐싱

`turbo.json`의 `build.outputs`에 이미 `dist/**`가 포함되어 있어 추가 설정은 불필요하다.

```jsonc
"build": { "dependsOn": ["^build"], "outputs": [".next/**", "!.next/cache/**", "dist/**"] }
```

`^build` 덕분에 `@sdf/types` → `@sdf/core-sdk`/`@sdf/ui` 순서로 위상 정렬되어 빌드된다.

---

## 3. 배포 절차

버전 관리는 [Changesets](https://github.com/changesets/changesets)를 권장한다.

```bash
# 1) 루트에서 전체 빌드 (위상 정렬 보장)
pnpm build            # turbo run build

# 2) 변경분 기록 — 영향받는 패키지와 semver 범프 선택
pnpm changeset

# 3) 버전 적용 (package.json 버전 + CHANGELOG 갱신, workspace:* 치환)
pnpm changeset version

# 4) 배포 — 빌드된 dist만 게시
pnpm -r publish --access public
```

CI(GitHub Actions)에서는 `changesets/action`으로 `version` PR 자동 생성 + 머지 시
자동 `publish`하는 파이프라인을 구성한다. `NPM_TOKEN` 시크릿이 필요하다.

---

## 4. 플러그인 컴포넌트 표준 규격

외부 개발자가 작성하는 위젯/플러그인은 다음 규격을 준수해야 메인 대시보드의
`LayoutGrid` + `DashboardErrorBoundary`와 안전하게 통합된다.

### 4.1 Presentation / Container 분리 (필수)

비즈니스 로직(스토어 구독, API 호출)은 훅으로, 시각화는 컴포넌트로 분리한다.
이로써 Storybook에서 store 없이 props만으로 렌더링 가능해야 한다. (`docs/Skill.md` 참조)

```tsx
// ❌ 금지: 컴포넌트가 직접 데이터를 fetch
// ✅ 권장: props로 데이터 + 콜백 주입
interface MyWidgetProps {
  data: SensorSnapshot
  onSelect?: (id: string) => void
  className?: string
}
```

### 4.2 에러 격리 계약 (필수)

플러그인 위젯은 **반드시** `DashboardErrorBoundary`로 감싸 등록한다.
수식 오류·렌더 크래시가 발생해도 3D 캔버스와 형제 위젯은 영향받지 않는다.

```tsx
import { DashboardErrorBoundary } from "@sdf/ui"

<DashboardErrorBoundary label="내 플러그인">
  <MyWidget data={snapshot} />
</DashboardErrorBoundary>
```

위젯 내부에서 절대 `try/catch`로 에러를 삼키지 말 것 — 경계로 전파시켜 격리한다.

### 4.3 수식·룰 연동 (선택)

커스텀 지표/조건식은 `@sdf/core-sdk`의 안전 파서를 사용한다.
`eval` 금지 — 재귀 하강 파서가 `+ - * / ( )`, 비교 연산자, `abs/min/max/sqrt`를 지원한다.

```ts
import { evaluateFormula, evaluateCondition } from "@sdf/core-sdk/formula"

const r = evaluateFormula("(vibration + temperature) / 2", vars)
if (r.ok) bindToChart(r.value)

const triggered = evaluateCondition("temperature > 100", vars)
```

### 4.4 레이아웃 등록 규격 (선택)

대시보드 패널로 편입하려면 `LayoutPanel` 좌표 규격(react-grid-layout v2)을 따른다.

```ts
// LayoutPanel: { id, label, x, y, w, h, visible }
// x/y/w/h는 그리드 단위 정수. v1의 col/row 문자열은 더 이상 사용하지 않는다.
{ id: "my-plugin", label: "내 플러그인", x: 0, y: 0, w: 2, h: 3, visible: true }
```

### 4.5 3D 메쉬 플러그인 (선택)

커스텀 3D 모델은 표준 GLB/GLTF만 허용한다. `loadGLTFModel(url, entityId)`이
바운딩 박스 기준 자동 스케일(최대 2 유닛) + 바닥 정렬을 수행하며,
`TransformControls` 기즈모와 격자 스냅에 자동 바인딩된다.

### 4.6 체크리스트

- [ ] 로직(hook)과 시각화(component)가 분리되어 있는가
- [ ] `DashboardErrorBoundary`로 감싸 등록했는가
- [ ] props만으로 (store 없이) 렌더링 가능한가 — Storybook 렌더 통과
- [ ] 수식은 `@sdf/core-sdk`의 안전 파서를 사용하는가 (`eval` 미사용)
- [ ] 레이아웃 좌표가 v2 `x/y/w/h` 규격인가
- [ ] `peerDependencies`로 react를 선언했는가 (번들에 react 미포함)
