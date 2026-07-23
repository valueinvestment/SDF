from plugins.contracts import Collector, PipelineStage
from simulator.models import MachineState


class _FakeCollector:
    id = "fake"
    machine_ids = ["M1"]
    poll_interval_sec = 1.0

    async def collect(self):
        return {}


class _FakePipelineStage:
    id = "fake-stage"

    def process(self, machine_id, state):
        return state


def test_conforming_collector_satisfies_protocol():
    assert isinstance(_FakeCollector(), Collector)


def test_conforming_pipeline_stage_satisfies_protocol():
    assert isinstance(_FakePipelineStage(), PipelineStage)


def test_non_conforming_object_does_not_satisfy_collector_protocol():
    class NotACollector:
        pass

    assert not isinstance(NotACollector(), Collector)
