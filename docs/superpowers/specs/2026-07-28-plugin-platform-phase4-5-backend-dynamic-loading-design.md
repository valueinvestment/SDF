# Phase 4.5 — 백엔드 플러그인 동적 로딩 설계

**상태:** 브레인스토밍 완료, 승인됨 (사용자 위임 검토 — 설계 검토 중 발견된 Collector 가시성 문제를 PipelineStage 예시로 교체해 반영, 2026-07-28)
**로드맵 참조:** `docs/superpowers/specs/2026-07-22-plugin-platform-roadmap-v2.md` Phase 4.5 섹션

## 목표

`apps/backend-sim/plugins/uploaded/`에 `.py` 파일을 배치하면 서버 재시작 없이 자동으로 감지·로드되어 `Collector`/`PipelineStage`로 등록되는 기능. Phase 1의 `CollectorRegistry.register()`/`PipelineRegistry.register()`를 그대로 재사용하고, 그 위에 주기적으로 폴더를 스캔하는 백그라운드 로더만 추가한다 — 두 레지스트리의 공개 API는 바뀌지 않는다.

## 격리 전략 (브레인스토밍 결론)

Python은 브라우저의 iframe과 달리 진짜 프로세스 격리(subprocess/multiprocessing)가 가능하지만, 이 코드베이스의 두 플러그인 타입은 격리 비용이 비대칭적이다: `PipelineStage.process()`는 `simulation_loop`의 동기 10Hz 핫패스 안에서 직접 호출되므로 서브프로세스 격리 시 매 tick마다 IPC 왕복이 필요해져 구조가 크게 무거워진다. `Collector.collect()`는 이미 자기만의 백그라운드 asyncio 태스크(`CollectorRegistry._run_loop`)에서 자기 주기로 돌고 있어 상대적으로 격리가 자연스럽다.

이 비대칭에도 불구하고, 이번 Phase는 **신뢰 기반, 프로세스 격리 없음**으로 결정했다 — Phase 4(프런트엔드)와 동일한 결론이지만 독립적으로 재평가한 결과다. 신뢰 경계는 "로컬 파일시스템에 `apps/backend-sim/plugins/uploaded/`에 파일을 배치할 수 있는 사람"으로 한정한다. Collector만 부분적으로 격리하는 절충안(2번째 논의 옵션)은 Collector/PipelineStage 간 아키텍처 비대칭을 낳고, 이번 스코프(신뢰된 개발자용)에 걸맞지 않은 엔지니어링 비용이라 채택하지 않았다.

**주입 경로**: HTTP 업로드 엔드포인트는 만들지 않는다 — 이는 신뢰 경계를 "파일시스템 접근자"에서 "이 포트에 닿는 누구나"로 실질적으로 넓히는 것이라 신뢰 기반 모델과 모순된다. 대신 지정 폴더를 백그라운드에서 주기적으로 폴링한다(추가 네트워크 표면 없음).

**기존 아키텍처의 제약 (설계 검토 중 발견, 이 Phase에서 해결하지 않음):** `main.py`의 `simulation_loop`은 `simulator.machine_ids`(프론트엔드가 `sync_entities`로 캔버스에 배치한 엔티티 목록)만 순회하며 브로드캐스트한다 — `CollectorRegistry`가 어떤 머신을 소유하는지는 참조하지 않는다. 따라서 동적으로 로드된 Collector가 `simulator.machine_ids`에 없는 새 머신 id를 등록하면, 등록·폴링·캐싱까지는 전부 정상 동작하지만 프론트엔드로는 절대 브로드캐스트되지 않는다 — 에러 없이 조용히 "보이지 않을" 뿐이다. 게다가 기존 M1~M5는 서버 부팅 시 `SimulatorCollector`가 이미 소유권(`_owner`)을 가져가므로, 다른 Collector가 같은 id를 등록하려 하면 충돌 에러가 난다. 결과적으로 현재 아키텍처에서 동적 Collector가 "새 머신을 대시보드에 나타나게" 만들 방법이 없다 — `simulation_loop`을 바꾸는 건 프런트엔드 렌더링(머신 좌표 등)까지 얽히는 별도 스코프라 이번 Phase에서 다루지 않는다. 이 제약 때문에 예시 플러그인은 Collector가 아니라 PipelineStage로 골랐다(아래 예시 섹션 참조) — PipelineStage는 이미 브로드캐스트 중인 머신의 상태만 변형하므로 이 문제 자체가 없다.

## 아키텍처 & 데이터 흐름

```
apps/backend-sim/plugins/uploaded/          ← 신규 디렉토리, gitignore, 개발자가 .py 파일을 직접 배치
        │
        ▼ (5초마다, main.py의 lifespan()에서 시작한 백그라운드 태스크)
scan_and_load(directory, collector_registry, pipeline_registry, loaded: set[str])
        │  loaded에 없는 파일만 처리 (서버 부팅 시 loaded={} 이므로 폴더의 기존 파일도 동일 경로로 처리됨 —
        │  시작 시 스캔과 주기 스캔이 별도 코드 경로가 아니라 같은 함수의 반복 호출)
        ├─ importlib.util로 파일을 모듈로 로드 (import 자체가 실패하면 print()만 하고 다음 파일로)
        ├─ module.collectors (있다면): 각 항목이 Collector 프로토콜을 만족하는지 isinstance()로 검증
        │    (@runtime_checkable) → collector_registry.register() 시도 → poll_once()로 즉시 프라임
        │    → 실패 시 collector_registry.record_error(collector.id, msg)
        ├─ module.pipeline_stages (있다면): 동일 패턴으로 pipeline_registry에 등록/에러기록
        └─ 새로 등록된 Collector는 collector_registry.start_all()(멱등)로 폴링 시작
```

핵심 설계 결정:
- **importlib.util.spec_from_file_location 사용** — `uploaded/`의 파일은 패키지 경로에 있지 않은 독립 파일이라 `import_module(name)`이 아니라 파일 경로 기반 로딩이 맞다.
- **모듈 형태 검증은 기존 `Collector`/`PipelineStage` `Protocol`의 `@runtime_checkable` 속성을 재사용** — 프런트엔드의 `assertPluginShape`에 해당하는 코드를 새로 작성할 필요가 없다.
- **등록 실패(중복 id 등)는 기존 `record_error()`를 재사용** — Phase 6에서 이미 구축된 `plugin_error` WebSocket 파이프라인을 타고 프런트엔드 Inspector에 추가 코드 없이 노출된다. (backend에는 프런트엔드의 `recordRejected`에 해당하는 별도 "등록 거부" 채널이 원래 없었다 — 정적 플러그인도 지금까지 등록 실패를 try/except로 감싸지 않았다. 새 채널을 만들기보다 기존 `record_error` 하나로 통일했다.)
- **재로딩/수정 반영은 비목표**: 같은 파일명은 한 번만 처리되고 `loaded`에 영구히 남는다. 파일을 고쳐도 재등록되지 않는다 — 파일명을 바꾸거나 서버를 재시작해야 한다. 신뢰된 개발자용 최소 기능이라는 스코프에 맞춘 의도적 단순화.
- **동기 I/O 허용**: `Path.glob()`과 `exec_module()`은 블로킹 호출이라 이벤트 루프를 잠깐 멈추지만, 5초 주기·소수의 로컬 파일이라는 전제하에 무시 가능한 수준으로 판단해 `asyncio.to_thread` 등으로 감싸지 않는다.

## 파일 변경 사항

### `apps/backend-sim/plugins/dynamic_loader.py` (신규)

```python
import asyncio
import importlib.util
import sys
from pathlib import Path

from plugins.contracts import Collector, PipelineStage
from plugins.collector_registry import CollectorRegistry
from plugins.pipeline_registry import PipelineRegistry


def _load_module_from_path(path: Path):
    spec = importlib.util.spec_from_file_location(f"uploaded_plugin_{path.stem}", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


async def scan_and_load(
    directory: Path,
    collector_registry: CollectorRegistry,
    pipeline_registry: PipelineRegistry,
    loaded: set[str],
) -> None:
    """Scans `directory` for .py files not yet in `loaded` and registers any
    `collectors`/`pipeline_stages` module-level lists they declare. Every attempted
    filename is added to `loaded` regardless of outcome — editing an already-loaded
    file has no effect until the file is renamed or the server restarts (`loaded`
    resets to empty on restart, so a fresh process re-processes everything in the
    folder). Hot-reload-on-edit is a deliberate non-goal; see the design doc."""
    if not directory.exists():
        return
    for path in sorted(directory.glob("*.py")):
        if path.name in loaded:
            continue
        loaded.add(path.name)
        try:
            module = _load_module_from_path(path)
        except Exception as e:
            print(f"[dynamic_loader] failed to import {path.name}: {e}", flush=True)
            continue

        for collector in getattr(module, "collectors", []):
            if not isinstance(collector, Collector):
                print(f"[dynamic_loader] {path.name}: collectors entry is not a valid Collector", flush=True)
                continue
            try:
                collector_registry.register(collector)
                await collector_registry.poll_once(collector.id)
            except Exception as e:
                collector_registry.record_error(collector.id, str(e))

        for stage in getattr(module, "pipeline_stages", []):
            if not isinstance(stage, PipelineStage):
                print(f"[dynamic_loader] {path.name}: pipeline_stages entry is not a valid PipelineStage", flush=True)
                continue
            try:
                pipeline_registry.register(stage)
            except Exception as e:
                pipeline_registry.record_error(stage.id, str(e))

    collector_registry.start_all()  # idempotent — only starts tasks for newly-registered collectors


async def dynamic_loader_loop(
    directory: Path,
    collector_registry: CollectorRegistry,
    pipeline_registry: PipelineRegistry,
    interval_sec: float = 5.0,
) -> None:
    """Background task: calls scan_and_load() on a timer for the process lifetime."""
    directory.mkdir(parents=True, exist_ok=True)
    loaded: set[str] = set()
    while True:
        await scan_and_load(directory, collector_registry, pipeline_registry, loaded)
        await asyncio.sleep(interval_sec)
```

`register()`가 던지는 예외를 `try/except`로 감싸는 부분은 프런트엔드 Phase 4의 `registerPlugin` 헬퍼와 정확히 같은 역할이다. `poll_once()`를 등록 직후 바로 호출하는 이유는 새로 추가된 Collector가 다음 `poll_interval_sec`을 기다리지 않고 즉시 캐시를 채우게 하기 위함 — `prime_all()`이 서버 부팅 시 하는 일을 개별 Collector 단위로 재현한 것이다. `_load_module_from_path`는 `exec_module()` 실행 전에 `sys.modules[spec.name] = module`을 먼저 등록한다 — 이걸 생략하면 로드되는 파일 내부에서 `@dataclass`처럼 자기 자신의 모듈을 `sys.modules`에서 찾는 코드가 있을 때 깨질 수 있다.

### `apps/backend-sim/main.py` (수정)

`lifespan()`에 새 백그라운드 태스크 추가:

```python
from pathlib import Path
from plugins.dynamic_loader import dynamic_loader_loop

UPLOADED_PLUGINS_DIR = Path(__file__).parent / "plugins" / "uploaded"

# lifespan() 내부, 기존 tasks 리스트에 추가:
tasks = [
    asyncio.create_task(simulation_loop()),
    asyncio.create_task(broadcast_loop()),
    asyncio.create_task(orchestrator.start()),
    asyncio.create_task(detail_loop()),
    asyncio.create_task(dynamic_loader_loop(UPLOADED_PLUGINS_DIR, collector_registry, pipeline_registry)),
]
```

### `.gitignore` (수정)

`apps/backend-sim/plugins/uploaded/*.py` 추가 — 업로드된 플러그인은 런타임 산출물이라 커밋 대상이 아니다(프런트엔드의 세션 한정 결정과 같은 정신). 디렉토리 자체는 `apps/backend-sim/plugins/uploaded/.gitkeep`으로 유지.

### `examples/plugins/example_pipeline_stage.py` (신규, 커밋됨)

```python
"""SDF Digital Twin — 예시 백엔드 플러그인 (런타임 동적 로딩용)

이 파일을 apps/backend-sim/plugins/uploaded/ 에 복사해두면, 서버가 5초 이내에
자동으로 감지해서 로드·등록합니다 (재시작 불필요) — 대시보드를 보고 있으면
곧 M1~M5 중 하나가 fault 상태로 바뀌는 걸 확인할 수 있습니다.

pipeline_stages: list[PipelineStage] 를 모듈 최상위에 정의하면 dynamic_loader가
이 리스트를 읽어 PipelineRegistry.register()를 대신 호출합니다 — 이 파일이 직접
registry를 다루지 않습니다.

Collector가 아니라 PipelineStage를 예시로 고른 이유: 동적으로 로드된 Collector가
simulator.machine_ids(프론트엔드가 캔버스에 배치한 엔티티 목록)에 없는 새 머신
id를 등록하면 등록·폴링까지는 성공하지만 브로드캐스트 대상에서 제외되어 대시보드에
보이지 않습니다(기존 아키텍처의 제약, 설계 문서의 "기존 아키텍처의 제약" 참조).
PipelineStage는 이미 브로드캐스트되고 있는 기존 머신의 상태를 매 tick마다 변형할
뿐이라 이 문제 자체가 없어, 파일을 놓자마자 바로 눈으로 확인할 수 있습니다.
"""
from simulator.models import MachineState


class ExampleVibrationThresholdStage:
    """진동이 임계값을 넘으면 상태를 fault로 전환하는 최소 예시 PipelineStage.
    임계값(60)은 정상 범위(20~80)의 중간값으로, 데모가 몇 초 안에 보이도록
    일부러 낮게 잡았다 — 실제 산업 안전 임계값이 아니다. 기존
    tests/test_plugin_integration.py의 ThresholdFaultStage와 같은 패턴이다.
    main.py의 anomaly_detected 발화 로직은 "fault로의 전이"만 감지하므로,
    이 스테이지가 상태를 바꾸면 기존 알림 파이프라인도 그대로 반응한다."""

    id = "example-vibration-threshold"

    def process(self, machine_id: str, state: MachineState) -> MachineState:
        if state.vibration > 60 and state.status == "normal":
            return state.model_copy(update={"status": "fault"})
        return state


pipeline_stages = [ExampleVibrationThresholdStage()]
```

## 에러 처리 요약

| 실패 지점 | 처리 | 표시 위치 |
|---|---|---|
| `.py` 파일 import 자체 실패 (문법 오류 등) | `print()`만, 다음 파일로 계속 진행 | 서버 로그만 (WS/Inspector 미노출 — 의도된 갭) |
| `collectors`/`pipeline_stages` 항목이 프로토콜 불일치 | `print()`만, 해당 항목만 skip | 서버 로그만 |
| `register()` 실패 (중복 id) | `collector_registry.record_error()` / `pipeline_registry.record_error()` | 기존 Phase 6 `plugin_error` WS 파이프라인 → 프런트엔드 Inspector "백엔드 에러" 섹션 |
| `collect()`/`process()` 런타임 실패 (기존 동작, 변경 없음) | 기존 `record_error()` 경로 그대로 | 동일 |

파일 하나가 어떤 이유로든 실패해도 `scan_and_load`의 `for` 루프는 `continue`로 다음 파일을 계속 처리한다 — 이 프로젝트의 "에러 격리는 프레임워크 책임" 원칙과 동일선상.

## 테스트 계획

**`tests/test_dynamic_loader.py`** (신규) — `pytest`의 `tmp_path` fixture로 격리된 임시 디렉토리에 실제 `.py` 파일을 써서 `scan_and_load()`를 호출하는 방식(모킹으로는 `importlib.util` 경로 로딩 자체의 정확성을 검증할 수 없다).

- 정상 케이스: `collectors = [FakeCollector(...)]`를 정의하는 파일을 써두고 `scan_and_load()` 호출 → `get_cached_state()`가 채워졌는지 확인(등록 + `poll_once` 즉시 프라임까지 검증)
- 재스캔 시 중복 로드 안 됨: 같은 디렉토리에 대해 `scan_and_load()`를 두 번 호출해도 `loaded` set 덕분에 두 번째 호출에서 아무 일도 안 일어남(register가 두 번째엔 호출조차 안 됨을 count로 확인)
- 문법 오류 파일: 깨진 문법의 `.py` 파일 → 예외가 밖으로 전파되지 않고, 그 파일이 `loaded`에 추가되어 재시도되지 않음을 확인
- 프로토콜 불일치 항목: `collectors = ["not a collector"]`인 파일 → 등록 안 됨, 크래시 없음
- 중복 id 등록 실패: 이미 등록된 id와 같은 id의 Collector를 새 파일에 정의 → `collector_registry.get_all_errors()`에 기록되는지 확인
- `pipeline_stages`도 대칭적으로 동일 케이스 최소 1개씩
- `sys.modules` 등록 확인: 로드된 모듈이 `sys.modules[f"uploaded_plugin_{stem}"]`에 실제로 존재하는지 확인 — 설계 중 발견한 버그가 회귀하지 않도록 고정하는 회귀 테스트

**`dynamic_loader_loop` 자체는 테스트 없음** — 이 프로젝트의 "thin glue / thick tested core" 컨벤션(Worker 래퍼, WS 훅 등과 동일)과 일치. 순수 로직은 전부 `scan_and_load()`에 있고, 루프는 그걸 5초마다 부르는 것뿐이다.

**기존 테스트 회귀 확인**: `main.py`에 새 백그라운드 태스크가 추가되므로 기존 pytest(61개) 전체가 여전히 통과하는지 확인한다. `test_plugin_integration.py`는 `lifespan()`을 직접 실행하지 않고 자체 레지스트리를 구성해 테스트하는 방식이라(코드 확인 완료) 영향받지 않는다 — `main.py`의 `lifespan()`을 직접 실행하는 테스트는 이 프로젝트에 원래 없다.

## 비목표

- HTTP 업로드 엔드포인트 (신뢰 경계를 네트워크로 넓히므로 채택 안 함)
- 서브프로세스/멀티프로세스 기반 진짜 프로세스 격리 (신뢰 기반 모델로 결정, PipelineStage의 핫패스 IPC 비용이 결정적 이유)
- 파일 수정 시 자동 재로딩(hot-reload-on-edit) — 파일명 변경 또는 서버 재시작 필요
- 프런트엔드 UI 변경 — 로드 실패는 기존 Inspector의 "백엔드 에러" 섹션을 그대로 재사용, 새 UI 없음
- 동적 Collector가 도입하는 새 머신 id를 대시보드에 보이게 만드는 것 — `simulation_loop`이 `simulator.machine_ids`(프런트엔드 `sync_entities` 기반)만 순회하는 기존 제약 때문에, 새 머신은 등록·폴링은 성공해도 브로드캐스트되지 않는다. 이를 고치려면 `simulation_loop`과 프런트엔드 렌더링(머신 좌표 등)까지 건드려야 해 별도 스코프로 취급한다 — 이번 Phase의 예시는 이 문제가 없는 PipelineStage로 골랐다.

## 의존관계

Phase 1 필수(완료). Phase 6의 `plugin_error` WS 파이프라인을 재사용(완료, 코드 변경 없이 그대로 사용).
