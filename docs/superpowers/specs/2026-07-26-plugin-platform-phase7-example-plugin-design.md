# Phase 7 — 예시 플러그인 실전 구현 설계

**날짜:** 2026-07-26
**상태:** 브레인스토밍 완료, 구현 계획 대기
**로드맵:** `docs/superpowers/specs/2026-07-22-plugin-platform-roadmap-v2.md` Phase 7 섹션 참조

## 1. 목표 및 스코프

로드맵 원안은 "Web Worker 기반 초대용량 바이너리(MDF/DAT) 파서"를 예시로 지금까지의 모든 플러그인 계약(Phase 0 패널 계약, Phase 1 Collector 계약, Phase 2 Render-Bypass 패턴)을 엔드투엔드로 검증하라고 명시했다. 정확한 데이터 흐름(풀스택/프런트엔드 전용)은 이 Phase 착수 시점에 결정하도록 되어 있었다.

**브레인스토밍 중 두 차례 방향 전환이 있었다:**

1. **실제 MDF 포맷 vs 자체 포맷.** 실제 MDF4는 ASAM 표준 바이너리 포맷으로, `IDBLOCK`→`HDBLOCK`→`DGBLOCK`→`CGBLOCK`→`CNBLOCK`의 링크드 블록 그래프 구조에 절대 오프셋 포인터, 게다가 MDF 4.1 이상은 데이터 블록이 `DZBLOCK`으로 deflate 압축되어 있어(웹 검색으로 확인) 실제 파일을 열려면 압축 해제까지 필요하다. 이는 "플러그인 계약 검증"이라는 이 Phase의 본래 목적과 무관하게 별도의 대규모 파서 프로젝트가 되어버린다고 판단해, **이 앱 도메인에 실제로 쓸모 있는 자체 바이너리 포맷(`.sdfrec`)**으로 방향을 바꿨다.
2. **가짜 테스트 픽스처 vs 진짜 데이터.** 처음엔 "세션 녹화(장시간 캡처)" 기능을 새로 만들어 진짜 대용량 데이터를 만드는 안을 검토했으나, 이 앱은 모니터링에 초점이 맞춰져 있고 장시간 녹화는 데이터 분석용 별개 기능이라는 이유로 **백로그로 이관**하고, 대신 **라이브 스토어의 현재 `machines[].history`(머신당 최근 300개 샘플, `HISTORY_MAX=300`)를 그대로 내보내는 작은 다운로드 기능** + **`examples/` 폴더에 별도로 생성한 대용량 데모 샘플**로 스코프를 좁혔다.

**최종 스코프:**
- `.sdfrec`라는 자체 바이너리 포맷 설계 (별도 스펙 문서 `docs/sdfrec-format-spec.md`)
- 프런트엔드 전용 예시 플러그인 3번째: 현재 세션(작은 파일) 다운로드 + `.sdfrec` 파일 업로드 → Web Worker 파싱 → 시각화
- `examples/` 폴더에 Web Worker의 이점이 체감되는 크기의 데모 샘플 파일

**제외 (백로그로 이관):**
- **장시간 세션 녹화 기능** — 화면용 300개 캡을 우회해 장시간 전체 이력을 별도로 누적하는 기능. 데이터 분석 목적이라 이 앱의 모니터링 초점과 다르고, 새 스토어 상태/UI 컨트롤이 필요해 스코프가 커진다. 로드맵 백로그에 기록.
- **실제 MDF4 파싱** — §1-1 사유로 제외.

## 2. `.sdfrec` 바이너리 포맷

전체 스펙은 `docs/sdfrec-format-spec.md` 참조(이 문서만으로 다른 언어에서도 인코더/디코더를 재구현할 수 있도록 독립적으로 작성됨). 핵심 설계:

- **자기서술적(self-describing):** 채널 이름/개수를 헤더에 선언하고 데이터 섹션은 채널 순서대로 값만 나열(태그 없음) — 이 앱의 3종 센서 필드(vibration/temperature/current)에 하드코딩되지 않아, 채널 구성이 바뀌어도 포맷 버전을 안 올려도 됨.
- **평평한(flat) 구조:** MDF류의 링크드 블록 그래프 대신 헤더 → 데이터 섹션 순차 배치. 파서가 위에서 아래로 한 번만 읽으면 됨.
- **컴팩트:** 샘플당 `4 + 4×channelCount` 바이트. 타임스탬프는 헤더의 절대 `sessionStartTs`(float64, 1회) + 샘플별 `tsOffsetMs`(uint32, ms 오프셋)로 분리해 반복 저장을 피함. 센서값은 float32(시뮬레이션 값이라 float64 정밀도 불필요).
- **자기 식별:** `magic`("SDFR") + `version`을 헤더 맨 앞에 둬서, `decode()`가 형식이 다른 파일을 조용히 깨지지 않고 명확한 에러로 거부.

## 3. 파일 구조

- `docs/sdfrec-format-spec.md` (완료, 이미 작성됨) — 독립 포맷 스펙.
- `apps/host-twin/lib/sdfRecording.ts` (신규) — `encode(machines)`/`decode(buffer)` 순수 함수. 스펙 문서의 직접적인 코드 구현.
- `apps/host-twin/workers/sdfRecordingParser.worker.ts` (신규) — 얇은 Worker 래퍼. `decode()`를 호출해 `{ok, data|error}`를 `postMessage`.
- `apps/host-twin/plugins/sessionRecorderPlugin.tsx` (신규) — 3번째 예시 플러그인.
- `examples/sdfrec/sample-session.sdfrec` (신규, 커밋) — 데모용 대용량 샘플(여러 머신 × 수천 샘플).
- `scripts/generate-sample-sdfrec.mjs` (신규) — 위 샘플을 `encode()`로 생성하는 1회성 스크립트.
- 로드맵 문서: Phase 7 섹션에 방향 전환 이유 기록 + "장시간 세션 녹화" 백로그 항목 추가.

## 4. Web Worker 아키텍처

Phase 6에서 확립한 "얇은 미검증 글루 + 두껍게 테스트된 순수 함수" 패턴을 그대로 따른다: `sdfRecordingParser.worker.ts`는 `sdfRecording.ts`의 `decode()`를 import해서 `self.onmessage`에서 호출하고 결과(성공 데이터 또는 에러 메시지)를 `postMessage`하는 것 외에 아무 로직도 갖지 않는다. 실제 파싱 로직(바이트 레이아웃 해석, magic/version 검증)은 전부 `decode()`에 있으므로 Worker 스레드 없이도 완전히 유닛 테스트 가능하다.

이 아키텍처는 플러그인 화이트리스트 모델과도 자연스럽게 맞아떨어진다: Worker는 호스트 상태에 전혀 접근하지 않는 순수 CPU 계산 샌드박스이고, 플러그인 패널은 업로드된 파일(사용자가 직접 준 데이터)과 `useStoreSlice`(기존 화이트리스트 API)만으로 다운로드 기능까지 구현할 수 있다 — `PluginContext`에 새 바인딩을 하나도 추가할 필요가 없다.

## 5. 플러그인 UI

`sessionRecorderPlugin.tsx` 패널 하나에 두 영역:

1. **현재 세션 다운로드** — `useStoreSlice`로 `machines` 읽기 → `encode()` → `Blob` + `URL.createObjectURL` → 숨겨진 `<a download>` 클릭 트리거 → URL revoke.
2. **파일 업로드** — 기존 `AddEntityModal`(`.glb/.gltf` 드래그앤드롭)과 동일한 시각 패턴, `accept=".sdfrec"`. 파일 선택 시 `ArrayBuffer`로 읽어 Worker에 전달(transferable) → 로딩 상태 → 응답 오면 `BaseECharts`로 파싱된 채널 시각화(머신이 여럿이면 드롭다운으로 선택). magic/version 불일치 시 Worker가 반환한 에러 메시지를 그대로 표시.

## 6. 테스트 계획

- **`apps/host-twin/lib/__tests__/sdfRecording.test.ts`** (핵심 커버리지, 순수 함수): 라운드트립(단일/복수 채널·머신, 샘플 수가 머신마다 다른 경우, 빈 `machines`), `magic` 불일치 에러, 미지원 `version` 에러, 255바이트 초과 id/채널명 에러, float32 정밀도 범위 내 근사치 검증.
- **`apps/host-twin/plugins/__tests__/sessionRecorderPlugin.test.tsx`** (기존 `sensorChartPlugin.test.tsx` 패턴 — `BaseECharts` 목업, `Worker` 글로벌을 동기적으로 `decode()` 호출하도록 목업): 다운로드 버튼 동작, 업로드→로딩→차트 렌더, 잘못된 파일 에러 표시, 머신 여러 개일 때 드롭다운 전환.
- **`sdfRecordingParser.worker.ts` 자체는 테스트하지 않음** — Phase 6의 `useWebSocket.ts`/`simulation_loop`와 동일한 이유(얇은 글루, 실제 로직은 이미 순수 함수 테스트로 커버).
- **`scripts/generate-sample-sdfrec.mjs`**: 별도 유닛 테스트 없음(1회성 유틸) — 산출물(`examples/sdfrec/sample-session.sdfrec`)이 decode 테스트의 실제 검증 대상 중 하나로 간접 커버.

## 7. 백로그로 이관하는 항목

- **장시간 세션 녹화 기능**: 화면용 300개 캡(`HISTORY_MAX`)과 별개로, 사용자가 "녹화 시작"을 누르면 그 이후 샘플을 캡 없이 별도 버퍼에 누적하다가 "녹화 종료" 시 `.sdfrec`로 다운로드하는 기능. 데이터 분석 목적이라 이 앱의 모니터링 초점과 다르고 새 스토어 상태/UI가 필요해 스코프 확장. 로드맵 문서에 백로그 항목으로 기록.

## 8. 의존관계

- Phase 0(`PluginPanel` 계약), Phase 1(`Collector` — 참고만, 이번 스코프는 프런트엔드 전용이라 직접 의존 없음), Phase 2(`useStoreSlice` Render-Bypass 패턴) 완료 전제 — 모두 완료됨.
- Phase 6의 "얇은 글루 + 순수 함수" 테스트 컨벤션을 그대로 재사용.
