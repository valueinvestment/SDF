# 오픈소스 모노레포 배포 가이드 (제외 대상 & 저장소 위생)

SDF 디지털 트윈을 오픈소스 모노레포 플러그인 플랫폼으로 공개·배포할 때
**리포지토리에서 제외해야 할 폴더/내용**과 위생 점검 항목을 정리한다.
NPM 패키지 게시 절차는 [`PUBLISHING.md`](./PUBLISHING.md) 참조.

---

## 1. 이미 `.gitignore`로 제외되는 항목 (추적 안 됨)

루트 `.gitignore`가 다음을 커버한다 — 별도 조치 불필요:

```
node_modules/      # 의존성
.next/             # Next.js 빌드 산출물
.turbo/            # Turborepo 캐시
dist/              # 패키지 빌드 산출물
*.tsbuildinfo      # TS 증분 빌드 정보
__pycache__/ *.pyc # Python 바이트코드
.venv/             # Python 가상환경 (수백 MB)
.env .env.local    # 시크릿
.vercel/           # Vercel 프로젝트 메타
.pytest_cache/     # pytest 캐시
uv.lock            # uv 잠금 파일
.claude/           # Claude Code 로컬 설정/룰
```

## 2. 추적되고 있으나 제거해야 하는 항목

| 대상 | 이유 | 조치 |
|---|---|---|
| `backend/tests/__pycache__/*.pyc` | `.gitignore` 규칙 이전에 커밋된 바이트코드 잔재 | `git rm -r --cached backend/tests/__pycache__` (이번 커밋에서 정리) |

> `.gitignore`는 **이미 추적 중인 파일을 소급 제외하지 않는다.** 한 번 `--cached` 제거가 필요하다.

## 3. 공개 전 제외/검토할 내부·개인 파일

| 대상 | 성격 | 권장 |
|---|---|---|
| `docs/0619.md` | 개인 진행 보고 메모(멘토 피드백 등) | 공개 리포에 커밋하지 않음 (untracked 유지 또는 `.gitignore` 추가) |
| `docs/superpowers/plans/*`, `docs/superpowers/specs/*` | 내부 설계/브레인스토밍 산출물 | 투명성 위해 유지하거나, 외부 노이즈면 별도 브랜치로 분리 |
| `**/.env.example` | 시크릿 **템플릿**(값 없음) | **유지** — 기여자 온보딩에 필요 |

## 4. 표준 앱 vs 모노레포 패키지 — 중복 디렉터리 정리

이 리포에는 두 갈래가 공존한다:

| 갈래 | 경로 | 워크스페이스 포함? | 역할 |
|---|---|---|---|
| 모노레포(배포 대상) | `apps/host-twin`, `apps/backend-sim`, `packages/*` | ✅ (`pnpm-workspace.yaml`: `apps/*`, `packages/*`) | OSS 배포·플러그인 생태계의 정본 |
| 단독 앱(레거시) | `frontend/`, `backend/` | ❌ (워크스페이스 밖, 독립 `npm`/`uv`) | 초기 단독 실행본 |

**오픈소스 모노레포 배포 시 `frontend/`와 `backend/`(단독본)는 `apps/host-twin`·`apps/backend-sim`의 중복본**이므로 배포 범위에서 제외(또는 정리)하는 것을 권장한다. 정본은 모노레포 한쪽으로 단일화한다.

> 주의: 두 갈래는 import 컨벤션이 다르다(`@/lib/*` vs `@sdf/*`). 단일화 시 정본은 `@sdf/*` 패키지를 소비하는 모노레포 쪽이다.

## 5. NPM 패키지 tarball 제외 (게시 단위)

각 `packages/*`를 npm에 게시할 때 **소스·테스트는 tarball에 포함하지 않는다.** `package.json`의 `files` 화이트리스트로 `dist`만 게시:

```jsonc
{
  "private": false,
  "files": ["dist"],
  "publishConfig": { "access": "public" }
}
```

`tsup`으로 ESM/CJS/`.d.ts`를 빌드(`dist/`)한 뒤 게시한다. 자세한 절차·스크립트는 [`PUBLISHING.md`](./PUBLISHING.md) §2–3.

## 6. 시크릿 점검 체크리스트

- [ ] `ANTHROPIC_API_KEY`는 **백엔드 `.env`에만** 존재하며 커밋되지 않음 (`.env`는 ignore)
- [ ] 프론트엔드에는 API 키 노출 없음 — `NEXT_PUBLIC_WS_URL`만 공개 환경변수
- [ ] `.env.example`에는 키 **이름만** 있고 값은 비어 있음
- [ ] git 히스토리에 과거 커밋된 시크릿이 없는지 점검(`git log -p`로 `.env` 흔적 확인)

## 7. 공개 전 최종 점검

- [ ] `LICENSE.txt` 존재 및 라이선스 명시 (현재 MIT)
- [ ] 루트 `README.md`로 프로젝트 개요·패키지·실행법 안내 (본 작업에서 추가)
- [ ] `CONTRIBUTING.md`로 기여 절차 안내 (존재)
- [ ] `HOW_TO_RUN.md`로 로컬 실행 안내 (존재)
- [ ] §2의 추적 잔재(`.pyc`) 제거 완료
