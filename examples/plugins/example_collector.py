"""SDF Digital Twin — 예시 백엔드 플러그인 (Collector 최소 예시)

이 파일은 `apps/backend-sim/plugins/installed.py`에 등록되어 있지 않다 — 실제
프로덕션 레지스트리를 건드리지 않고, `Collector` 프로토콜(`plugins/contracts.py`)의
모양을 보여주는 "복사해서 시작하는" 참고용 코드다. 실제로 새 Collector를 만들 때는
`plugins/simulator_collector.py`(프로덕션에서 쓰이는 실제 구현)와 이 파일을
함께 참고하면 된다.

왜 installed.py에 넣지 않았나: Collector가 소유하는 machine_id는 프론트엔드가
캔버스에 배치한 머신 id(M1~M5, R1~R3)와 겹치면 CollectorRegistry.register()가
"이미 다른 collector가 소유 중"이라며 즉시 예외를 던진다(collector_registry.py의
소유권 검증). 반대로 겹치지 않는 새 id(아래 예시의 "EX1")를 쓰면 등록·폴링 자체는
성공하지만 broadcast_loop가 프론트엔드의 엔티티 목록에 없는 머신은 내보내지 않아
대시보드에는 전혀 보이지 않는다(기존 아키텍처의 제약 — example_pipeline_stage.py의
주석에도 동일하게 기록되어 있다). 즉 Collector는 PipelineStage와 달리 "파일 하나
떨어뜨리고 화면에서 바로 확인"하는 데모가 구조적으로 불가능하다 — 이 예시는 코드
모양과 동작(에러 없이 등록·폴링됨)을 확인하는 용도로 쓰자.

테스트해보고 싶다면: 이 파일을 apps/backend-sim/plugins/uploaded/에 복사하면 5초
이내 자동 로드되어 등록·폴링이 시작된다. 성공 여부는 대시보드가 아니라 Plugin
Inspector 패널의 등록 목록(에러가 없으면 성공)이나 서버 로그로 확인한다.
"""
import random
from simulator.models import MachineState


class ExampleRandomWalkCollector:
    """단일 가상 머신("EX1")에 대해 랜덤워크로 값을 생성하는 최소 Collector.
    실제 장비 대신 온도/진동/전류를 매 poll마다 이전 값 기준 소폭 변동시킨다 —
    Modbus/OPC-UA/REST 등 실제 프로토콜로 교체할 자리에 무엇이 들어가야 하는지
    보여주는 자리표시자다."""

    id = "example-random-walk"
    machine_ids = ["EX1"]
    poll_interval_sec = 1.0

    def __init__(self):
        self._temperature = 40.0
        self._vibration = 30.0
        self._current = 10.0

    async def collect(self) -> dict[str, MachineState]:
        self._temperature += random.uniform(-1, 1)
        self._vibration += random.uniform(-2, 2)
        self._current += random.uniform(-0.5, 0.5)
        state = MachineState(
            vibration=self._vibration,
            temperature=self._temperature,
            current=self._current,
            status="normal",
        )
        return {"EX1": state}


collectors = [ExampleRandomWalkCollector()]
