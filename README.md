# SDF Digital Twin — No-Code Builder Platform

실시간 3D 디지털 트윈 + 멀티 에이전트(Claude) 오케스트레이션을 결합한,
사용자가 코드 수정 없이 커스터마이징·확장할 수 있는 **오픈소스 노코드 빌더 플랫폼**.

Next.js(Three.js·ECharts) 프론트엔드와 FastAPI(asyncio·WebSocket) 백엔드가
단일 영속 WebSocket으로 통신하며, 공장 플로어를 3D로 시뮬레이션하고
이상 감지 시 AI 에이전트 체인(진단→배차→RICE 의사결정)을 가동한다.

---

## 모노레포 구조

pnpm 워크스페이스 + Turborepo 기반.

```
apps/
├── host-twin/      메인 웹 대시보드 (Next.js, Vercel 배포)
└── backend-sim/    FastAPI WebSocket 서버 (Railway 배포)

packages/
├── types/          @sdf/types     공유 타입 (ISA-95 데이터 모델 · 플러그인 명세)
├── core-sdk/       @sdf/core-sdk  헤드리스 로직 (수식 평가기 · 시뮬레이터) — React 비의존
└── ui/             @sdf/ui        Styled 컴포넌트 킷 (Tailwind)
```

> `frontend/`·`backend/`는 초기 단독 실행본(레거시)으로 워크스페이스 밖에 있다.
> 배포·기여의 정본은 모노레포(`apps/*` + `packages/*`)다. (→ [`docs/DISTRIBUTION.md`](./docs/DISTRIBUTION.md))

## 핵심 기능

- **3D 노코드 저작** — 장비 추가·정밀 스케일, 외부 GLB/GLTF 모델 업로드(드래그앤드롭/URL), `TransformControls` 기즈모 + 격자 스냅
- **가변 그리드 레이아웃** — 위젯 드래그 이동·리사이즈(react-grid-layout), 편집 모드 크기 시각화, URL/localStorage 영속화
- **데이터 변환 & 시뮬레이터** — 안전 수식 파서 기반 커스텀 지표, 가우시안 노이즈 모킹, 배속 컨트롤
- **가상 MES & 동적 룰 엔진** — ISA-95 WorkOrder, 조건부 룰·헤드리스 액션(오버레이/사운드/Webhook), 폐루프 공정 우회
- **결함 격리 & 공유** — 위젯 단위 ErrorBoundary, lz-string URL 인코딩 + 길이 초과 방어

## 빠른 시작

```bash
pnpm install
pnpm dev        # turbo: apps/host-twin + apps/backend-sim 동시 구동
```

백엔드는 `ANTHROPIC_API_KEY`가 필요하다. 각 백엔드의 `.env.example`을 복사해 `.env`를 만든다.
상세 실행법은 [`HOW_TO_RUN.md`](./HOW_TO_RUN.md) 참조.

## 스크립트 (루트, Turborepo)

| 명령 | 동작 |
|---|---|
| `pnpm dev` | 전체 개발 서버 구동 |
| `pnpm build` | 전체 빌드 |
| `pnpm test` | 전체 테스트 |
| `pnpm typecheck` | 전체 타입 검사 |
| `pnpm lint` | 전체 린트 |

## 플러그인 개발 & 배포

`@sdf/types` 인터페이스만 준수하면 호스트 앱 코드를 건드리지 않고 위젯·플러그인을 확장·배포할 수 있다.
플러그인 표준 규격과 NPM 배포 절차는 [`docs/PUBLISHING.md`](./docs/PUBLISHING.md),
공개 배포 시 제외 대상은 [`docs/DISTRIBUTION.md`](./docs/DISTRIBUTION.md)를 참조한다.

## 문서

| 문서 | 내용 |
|---|---|
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | 시스템 아키텍처 · 데이터 계약 · 설계 결정 |
| [`docs/PRD.md`](./docs/PRD.md) | 제품 요구사항 · 기능 스코프 |
| [`docs/FEATURES.md`](./docs/FEATURES.md) | 런타임 기능 명세 |
| [`docs/Skill.md`](./docs/Skill.md) | Headless/Styled 컴포넌트 패턴 |
| [`docs/PUBLISHING.md`](./docs/PUBLISHING.md) | NPM 배포 · 플러그인 표준 규격 |
| [`docs/DISTRIBUTION.md`](./docs/DISTRIBUTION.md) | 오픈소스 배포 시 제외 대상 · 위생 |

## 라이선스

MIT — [`LICENSE.txt`](./LICENSE.txt) 참조.
