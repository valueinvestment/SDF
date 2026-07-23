import pytest
from plugins.contracts import Collector
from plugins.simulator_collector import SimulatorCollector
from simulator.sensor_simulator import SensorSimulator


def test_simulator_collector_satisfies_collector_protocol():
    sim = SensorSimulator(seed=42)
    collector = SimulatorCollector(simulator=sim)
    assert isinstance(collector, Collector)


@pytest.mark.asyncio
async def test_collect_returns_all_simulator_machines():
    sim = SensorSimulator(seed=42)
    collector = SimulatorCollector(simulator=sim)
    states = await collector.collect()
    assert set(states.keys()) == set(sim.machine_ids)


@pytest.mark.asyncio
async def test_collect_reflects_injected_fault():
    sim = SensorSimulator(seed=42)
    sim.inject_fault("M1")
    collector = SimulatorCollector(simulator=sim)
    states = await collector.collect()
    assert states["M1"].status == "fault"


def test_machine_ids_reflects_live_simulator_state_after_dynamic_sync():
    """Regression guard: ws_gateway._handle_sync_entities can add/remove machines
    at runtime via simulator.sync_entities(). machine_ids must stay live so newly
    synced machines are picked up on the next poll instead of never being collected."""
    sim = SensorSimulator(seed=42)
    collector = SimulatorCollector(simulator=sim)
    assert set(collector.machine_ids) == set(sim.machine_ids)

    sim.sync_entities(machines={"M9": (1.0, 1.0)}, robots={})
    assert "M9" in collector.machine_ids
