# SDF 디지털 트윈 빌더 기여 가이드라인 (Contributing Guide) 🤝

SDF 오픈소스 프로젝트에 기여해 주셔서 감사합니다! 여러분의 참여는 스마트 팩토리와 디지털 트윈 생태계를 풍요롭게 만드는 큰 힘이 됩니다. 버그 리포트, 아이디어 제안, 새로운 커스텀 플러그인 및 코어 로직 개선 등 모든 종류의 기여를 환영합니다.

## 🛠️ 개발 환경 구축하기

본 프로젝트는 복합 패키지의 유기적인 관리를 위해 **Turborepo** 및 **pnpm Workspaces**를 채택하고 있습니다.

1. 본 레포지토리를 **Fork**한 후 로컬 환경에 클론합니다.
2. 글로벌 환경에 pnpm이 설치되어 있어야 합니다: `npm i -g pnpm`
3. 의존성 설치: `pnpm install`
4. 로컬 빌드 테스트: `pnpm build`를 실행하여 `packages/` 내부 코드들이 올바르게 트랜스파일되는지 확인합니다.

## 🌿 브랜치 전략 & 작업 흐름

SDF는 별도의 통합(`develop`) 브랜치 없이, `main`을 기준으로 직접 기능 브랜치를 파생하는 워크플로우를 가집니다.

* `main`: 상용 프로덕션 환경에 배포되는 가장 안정적인 브랜치이자, 모든 기여 작업의 기준(base) 브랜치입니다.
* `feature/기능명`: 새로운 기능, 플러그인, 아키텍처 개편을 진행하는 개별 작업 브랜치입니다. `main`에서 파생합니다.

### 1. 이슈(Issue) 발행
코드 수정을 시작하기 전에, 먼저 프로젝트의 Github Issue 탭에 버그나 구현하려는 사양에 대해 작성하여 메인 관리자들과 방향성을 싱크해 주세요.

### 2. 풀 리퀘스트(Pull Request) 제출 규칙
* 변경 사항에 대한 작업은 반드시 `main` 브랜치에서 파생된 `feature/` 브랜치에서 진행해 주세요.
* 풀 리퀘스트 대상 브랜치는 **`main`** 브랜치여야 합니다.
* 모노레포 내부의 코드 변경이 완료되면, 루트 디렉토리에서 `pnpm changeset`을 실행하여 변경된 패키지의 시맨틱 버전(major/minor/patch) 및 변경 로그(Changelog) 마크다운을 반드시 생성해 주세요.

## 📝 커밋 메시지 컨벤션 (Commit Convention)

일관된 히스토리 추적을 위해 Angular 커밋 메시지 규격을 준수합니다.

* `feat`: 새로운 기능 또는 컴포넌트/플러그인 추가
* `fix`: 버그 수정
* `docs`: 마크다운 등 문서 수정
* `style`: 코드 포맷팅, 세미콜론 누락 등 (비즈니스 로직 변경 없음)
* `refactor`: 코드 리팩터링 (성능 개선, 스키마 리스트 정비 등)
* `test`: 테스트 코드 추가 및 리팩터링

*예시: `feat(core-sdk): 가우시안 노이즈 필터링 연산 모듈 추가`*

## 💡 플러그인 기여 시 유의사항

### 프런트엔드 플러그인

1. `pnpm create-plugin <kebab-case-이름>`으로 스캐폴드를 생성하면 `apps/host-twin/plugins/<이름>Plugin.tsx` + 테스트 파일이 만들어지고 `apps/host-twin/lib/plugins.ts`의 `installedPlugins` 배열에 자동 등록됩니다. 직접 작성하려면 `SDFPlugin`(`packages/types`) 형태의 객체를 만들어 같은 배열에 수동으로 추가하세요.
2. 패널 컴포넌트는 `PluginProps`만 인자로 받습니다 — 호스트 스토어에 직접 접근할 수 없고 화이트리스트로 노출된 두 가지만 씁니다: `useStoreSlice(selector)`(구독, 값이 실제로 바뀔 때만 리렌더), `setDemoMode(enabled)`(데모 모드 토글, 현재 유일한 쓰기 메서드). `activate(ctx)` 시점에는 `PluginContext`의 `registerPanel`/`registerRule`/`registerMetric`/`store.getState`/`store.subscribe`만 노출됩니다.
3. 새로운 시각화 플러그인을 기여할 때에는 `packages/ui`에서 제공되는 프리미티브 아토믹 컴포넌트를 우선적으로 활용해 주세요.
4. 포매터 수식 계산 등 예기치 못한 예외가 발생할 수 있는 로직은 플랫폼 안정성을 위해 반드시 `DashboardErrorBoundary` 범주 안에서 안전하게 렌더링되도록 방어 코드를 작성해야 합니다 (패널은 자동으로 이 경계에 감싸입니다).
5. 재빌드 없이 테스트해보고 싶다면 개발 모드에서 Plugin Inspector 패널에 `.js` 파일을 드래그 업로드하면 됩니다 — 단, 이 경로는 네이티브 `import()`로 로드되므로 `export default { id, name, version, activate }` 형태만 가능하고 bare-specifier import(`import React from "react"` 등)는 쓸 수 없습니다.

### 백엔드 플러그인

1. `apps/backend-sim/plugins/contracts.py`의 `Collector`(머신별 데이터 수집, 자체 폴링 주기) 또는 `PipelineStage`(머신 상태 가공, 전역 순서 리스트) 프로토콜을 구현하세요.
2. `apps/backend-sim/plugins/installed.py`의 `build_installed_collectors()` / `installed_pipeline_stages`에 등록합니다.
3. 재빌드 없이 테스트하려면 `.py` 파일을 `apps/backend-sim/plugins/uploaded/`에 넣으면 5초 이내 자동 로드됩니다 (이 디렉토리는 gitignore 대상 — 커밋하지 마세요).

### 화이트리스트에 대한 중요한 참고사항

프런트엔드/백엔드 모두 위 화이트리스트는 **실수 방지 장치이지 진짜 보안 경계가 아닙니다.** 동적 로딩된 코드는 호스트와 같은 JS 런타임/프로세스에서 실행되므로, 신뢰할 수 없는 제3자 코드를 실행하는 용도로 설계되지 않았습니다 — 신뢰된 개발자·개발 환경 전용입니다. 상세 근거는 `docs/superpowers/specs/2026-07-26-plugin-platform-phase4-dynamic-plugin-injection-design.md`의 위협 모델 섹션을 참조하세요.

### 테스트 컨벤션

플러그인 테스트는 소스 파일과 나란히 둡니다: 프런트엔드는 `apps/host-twin/plugins/__tests__/`, 백엔드는 `apps/backend-sim/tests/`. 기존 예시 플러그인(`sensorChartPlugin`, `alertLogPlugin`, `example_pipeline_stage.py` 등)의 테스트를 참고하세요.