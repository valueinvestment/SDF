import pytest
from simulator.models import MachineState, RobotState, SensorSnapshot, WSMessage

def test_machine_state_normal():
    m = MachineState(vibration=50.0, temperature=70.0, current=15.0, status="normal")
    assert m.status == "normal"

def test_machine_state_rejects_invalid_status():
    with pytest.raises(Exception):
        MachineState(vibration=50.0, temperature=70.0, current=15.0, status="broken")

def test_sensor_snapshot_serializes():
    snap = SensorSnapshot(
        ts=1000,
        machines={"M1": MachineState(vibration=50.0, temperature=70.0, current=15.0, status="normal")},
        robots={"R1": RobotState(x=5.0, y=5.0, heading=0.0, status="idle")},
    )
    data = snap.model_dump()
    assert data["machines"]["M1"]["status"] == "normal"

def test_ws_message_sensor_update():
    snap = SensorSnapshot(ts=1000, machines={}, robots={})
    msg = WSMessage(type="sensor_update", payload=snap.model_dump())
    assert msg.type == "sensor_update"
