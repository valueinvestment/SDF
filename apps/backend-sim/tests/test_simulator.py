import pytest
from simulator.sensor_simulator import SensorSimulator

def test_initial_machine_statuses_are_normal():
    sim = SensorSimulator(seed=42)
    snapshot = sim.tick()
    for mid, machine in snapshot.machines.items():
        assert machine.status == "normal"

def test_all_machines_present():
    sim = SensorSimulator(seed=42)
    snapshot = sim.tick()
    assert set(snapshot.machines.keys()) == {"M1", "M2", "M3", "M4", "M5"}

def test_all_robots_present():
    sim = SensorSimulator(seed=42)
    snapshot = sim.tick()
    assert set(snapshot.robots.keys()) == {"R1", "R2", "R3"}

def test_sensor_values_in_normal_range():
    sim = SensorSimulator(seed=42)
    for _ in range(10):
        snapshot = sim.tick()
    for m in snapshot.machines.values():
        if m.status == "normal":
            assert 20 <= m.vibration <= 80
            assert 40 <= m.temperature <= 90
            assert 5 <= m.current <= 30

def test_fault_injection_changes_status():
    sim = SensorSimulator(seed=42)
    sim.inject_fault("M1")
    snapshot = sim.tick()
    assert snapshot.machines["M1"].status in ("degraded", "fault")
