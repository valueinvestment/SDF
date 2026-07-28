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
보이지 않습니다(기존 아키텍처의 제약). PipelineStage는 이미 브로드캐스트되고 있는
기존 머신의 상태를 매 tick마다 변형할 뿐이라 이 문제 자체가 없어, 파일을 놓자마자
바로 눈으로 확인할 수 있습니다.
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
