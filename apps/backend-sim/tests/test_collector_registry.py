import pytest
from plugins.collector_registry import CollectorRegistry
from simulator.models import MachineState


def make_state(status="normal"):
    return MachineState(vibration=50.0, temperature=60.0, current=10.0, status=status)


class FakeCollector:
    def __init__(self, id, machine_ids, poll_interval_sec=0.05, states=None, fail=False):
        self.id = id
        self.machine_ids = machine_ids
        self.poll_interval_sec = poll_interval_sec
        self._states = states or {mid: make_state() for mid in machine_ids}
        self.fail = fail
        self.call_count = 0

    async def collect(self):
        self.call_count += 1
        if self.fail:
            raise RuntimeError("collector failed")
        return dict(self._states)


def test_register_rejects_duplicate_collector_id():
    registry = CollectorRegistry()
    registry.register(FakeCollector("c1", ["M1"]))
    with pytest.raises(ValueError, match="collector id already registered"):
        registry.register(FakeCollector("c1", ["M2"]))


def test_register_rejects_overlapping_machine_ownership():
    registry = CollectorRegistry()
    registry.register(FakeCollector("c1", ["M1"]))
    with pytest.raises(ValueError, match="already owned by collector"):
        registry.register(FakeCollector("c2", ["M1"]))


def test_get_cached_state_returns_none_before_any_poll():
    registry = CollectorRegistry()
    registry.register(FakeCollector("c1", ["M1"]))
    assert registry.get_cached_state("M1") is None
