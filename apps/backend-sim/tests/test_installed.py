from simulator.sensor_simulator import SensorSimulator
from plugins.installed import build_installed_collectors, installed_pipeline_stages


def test_build_installed_collectors_owns_all_simulator_machines():
    sim = SensorSimulator(seed=42)
    collectors = build_installed_collectors(sim)
    owned = {mid for c in collectors for mid in c.machine_ids}
    assert owned == set(sim.machine_ids)


def test_installed_pipeline_stages_starts_empty():
    assert installed_pipeline_stages == []
