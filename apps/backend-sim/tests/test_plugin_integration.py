import asyncio
import pytest
from plugins.collector_registry import CollectorRegistry
from plugins.pipeline_registry import PipelineRegistry
from simulator.models import MachineState


def make_state(status="normal", temperature=60.0):
    return MachineState(vibration=50.0, temperature=temperature, current=10.0, status=status)


class SlowCollector:
    """Simulates a real device with non-trivial I/O latency."""

    id = "slow"
    machine_ids = ["M1", "M2"]
    poll_interval_sec = 0.03

    def __init__(self):
        self.call_count = 0

    async def collect(self):
        self.call_count += 1
        await asyncio.sleep(0.01)
        return {
            "M1": make_state(temperature=60.0),
            "M2": make_state(temperature=60.0),
        }


class FailingStage:
    """Always throws — must not break the pipeline for any machine."""

    id = "failing-stage"

    def process(self, machine_id, state):
        raise RuntimeError("stage always fails")


class ThresholdFaultStage:
    id = "threshold-fault"

    def process(self, machine_id, state):
        if machine_id == "M1" and state.temperature > 50:
            return state.model_copy(update={"status": "fault"})
        return state


@pytest.mark.asyncio
async def test_slow_collector_and_failing_stage_do_not_block_or_crash_the_pipeline():
    collector_registry = CollectorRegistry()
    pipeline_registry = PipelineRegistry()
    collector = SlowCollector()
    collector_registry.register(collector)
    pipeline_registry.register(FailingStage())

    await collector_registry.prime_all()

    for mid in ["M1", "M2"]:
        cached = collector_registry.get_cached_state(mid)
        assert cached is not None
        result = pipeline_registry.run(mid, cached)
        assert result.temperature == 60.0  # FailingStage never applied, pre-stage state passed through


@pytest.mark.asyncio
async def test_cache_forces_offline_when_collector_stops_succeeding():
    collector_registry = CollectorRegistry()
    collector = SlowCollector()
    collector_registry.register(collector)
    await collector_registry.prime_all()
    collector_registry._cache["M1"].last_success -= 1.0  # well beyond 3 * 0.03s
    assert collector_registry.get_cached_state("M1").status == "offline"
    assert collector_registry.get_cached_state("M2").status != "offline"


def test_anomaly_transition_detection_fires_on_any_source_of_fault():
    """Mirrors the transition-detection logic main.py's broadcast loop uses:
    fire once when a machine's post-pipeline status transitions TO "fault",
    regardless of whether a PipelineStage or the raw collected state caused it."""
    pipeline_registry = PipelineRegistry()
    pipeline_registry.register(ThresholdFaultStage())

    last_status: dict[str, str] = {}
    fired: list[str] = []

    def tick(machine_id: str, raw_state: MachineState) -> None:
        processed = pipeline_registry.run(machine_id, raw_state)
        previous = last_status.get(machine_id)
        if processed.status == "fault" and previous != "fault":
            fired.append(machine_id)
        last_status[machine_id] = processed.status

    tick("M1", make_state(temperature=60.0))  # threshold stage flips to fault
    tick("M1", make_state(temperature=60.0))  # still fault — must not re-fire
    tick("M1", make_state(temperature=10.0))  # recovers to normal
    tick("M1", make_state(temperature=60.0))  # faults again — must re-fire

    assert fired == ["M1", "M1"]
