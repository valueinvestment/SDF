import pytest
from simulator.detail_simulator import DetailSimulator
from simulator.sensor_simulator import MACHINE_POSITIONS, ROBOT_POSITIONS

def test_machine_detail_has_all_parts():
    sim = DetailSimulator(seed=42)
    detail = sim.get_machine_detail("M1")
    assert set(detail["components"].keys()) == {"body", "motor", "actuator", "sensor_unit"}

def test_machine_detail_wear_in_range():
    sim = DetailSimulator(seed=42)
    detail = sim.get_machine_detail("M2")
    for part, data in detail["components"].items():
        assert 0 <= data["wear"] <= 100

def test_thermal_grid_shape():
    sim = DetailSimulator(seed=42)
    detail = sim.get_machine_detail("M3")
    assert len(detail["thermalGrid"]) == 4
    assert all(len(row) == 4 for row in detail["thermalGrid"])

def test_robot_path_detail_has_path():
    sim = DetailSimulator(seed=42)
    path = sim.get_robot_path("R1")
    assert "recommendedPath" in path
    assert isinstance(path["recommendedPath"], list)

def test_inject_fault_raises_wear():
    sim = DetailSimulator(seed=42)
    sim.inject_component_fault("M1", "motor")
    detail = sim.get_machine_detail("M1")
    assert detail["components"]["motor"]["status"] in ("warn", "critical")
