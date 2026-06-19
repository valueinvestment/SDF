from pydantic import BaseModel
from typing import Literal, Dict, Any

MachineStatus = Literal["normal", "degraded", "fault"]
RobotStatus = Literal["idle", "moving", "dispatched", "arrived"]

class MachineState(BaseModel):
    vibration: float      # Hz
    temperature: float    # °C
    current: float        # A
    status: MachineStatus

class RobotState(BaseModel):
    x: float
    y: float
    heading: float        # degrees
    status: RobotStatus

class SensorSnapshot(BaseModel):
    ts: int               # unix ms
    machines: Dict[str, MachineState]
    robots: Dict[str, RobotState]

class DispatchCommand(BaseModel):
    robotId: str
    targetMachineId: str
    path: list[list[float]]   # [[x,y], ...]
    estimatedArrival: float   # seconds

class AgentEvent(BaseModel):
    agentId: Literal["A", "B", "C"]
    status: Literal["running", "complete", "error"]
    summary: str
    ts: int

class WSMessage(BaseModel):
    type: str
    payload: Any
