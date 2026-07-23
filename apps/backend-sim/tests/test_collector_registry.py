import time

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


@pytest.mark.asyncio
async def test_poll_once_populates_cache():
    registry = CollectorRegistry()
    registry.register(FakeCollector("c1", ["M1", "M2"]))
    await registry.poll_once("c1")
    assert registry.get_cached_state("M1").status == "normal"
    assert registry.get_cached_state("M2").status == "normal"


@pytest.mark.asyncio
async def test_poll_once_keeps_last_known_good_state_on_failure():
    registry = CollectorRegistry()
    collector = FakeCollector("c1", ["M1"])
    registry.register(collector)
    await registry.poll_once("c1")
    collector.fail = True
    await registry.poll_once("c1")
    assert registry.get_cached_state("M1").status == "normal"  # last good value retained
    assert collector.call_count == 2


@pytest.mark.asyncio
async def test_cached_state_forced_offline_after_stale_threshold():
    registry = CollectorRegistry()
    registry.register(FakeCollector("c1", ["M1"], poll_interval_sec=0.01))
    await registry.poll_once("c1")
    registry._cache["M1"].last_success = time.time() - 1.0  # far beyond 3 * 0.01s
    result = registry.get_cached_state("M1")
    assert result.status == "offline"


@pytest.mark.asyncio
async def test_cached_state_not_offline_within_threshold():
    registry = CollectorRegistry()
    registry.register(FakeCollector("c1", ["M1"], poll_interval_sec=1.0))
    await registry.poll_once("c1")
    result = registry.get_cached_state("M1")
    assert result.status == "normal"


import asyncio


@pytest.mark.asyncio
async def test_prime_all_polls_every_registered_collector():
    registry = CollectorRegistry()
    registry.register(FakeCollector("c1", ["M1"]))
    registry.register(FakeCollector("c2", ["M2"]))
    await registry.prime_all()
    assert registry.get_cached_state("M1") is not None
    assert registry.get_cached_state("M2") is not None


@pytest.mark.asyncio
async def test_start_all_runs_background_polls():
    registry = CollectorRegistry()
    collector = FakeCollector("c1", ["M1"], poll_interval_sec=0.02)
    registry.register(collector)
    registry.start_all()
    await asyncio.sleep(0.07)
    registry.stop_all()
    assert collector.call_count >= 2


@pytest.mark.asyncio
async def test_start_all_is_idempotent_for_already_started_collector():
    registry = CollectorRegistry()
    collector = FakeCollector("c1", ["M1"], poll_interval_sec=0.02)
    registry.register(collector)
    registry.start_all()
    registry.start_all()  # must not spawn a second task for the same collector
    await asyncio.sleep(0.05)
    registry.stop_all()
    call_count_after_stop = collector.call_count
    await asyncio.sleep(0.05)
    assert collector.call_count == call_count_after_stop  # stop_all actually cancelled the task
