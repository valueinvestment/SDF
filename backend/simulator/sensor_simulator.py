import random
import time
from simulator.models import MachineState, RobotState, SensorSnapshot

MACHINE_POSITIONS: dict[str, tuple[float, float]] = {
    "M1": (3.0, 3.0),
    "M2": (7.0, 3.0),
    "M3": (12.0, 3.0),
    "M4": (3.0, 12.0),
    "M5": (12.0, 12.0),
}

ROBOT_POSITIONS: dict[str, tuple[float, float]] = {
    "R1": (10.0, 10.0),
    "R2": (5.0, 5.0),
    "R3": (15.0, 5.0),
}

class SensorSimulator:
    def __init__(self, seed: int = 0):
        self._rng = random.Random(seed)
        self._faulted: set[str] = set()
        self._robot_positions = {k: list(v) for k, v in ROBOT_POSITIONS.items()}
        self._robot_headings = {k: 0.0 for k in ROBOT_POSITIONS}
        self._robot_statuses = {k: "idle" for k in ROBOT_POSITIONS}

    def inject_fault(self, machine_id: str) -> None:
        self._faulted.add(machine_id)

    def clear_fault(self, machine_id: str) -> None:
        self._faulted.discard(machine_id)

    def set_robot_status(self, robot_id: str, status: str) -> None:
        self._robot_statuses[robot_id] = status

    def move_robot(self, robot_id: str, x: float, y: float) -> None:
        self._robot_positions[robot_id] = [x, y]

    def tick(self) -> SensorSnapshot:
        machines = {}
        for mid in MACHINE_POSITIONS:
            if mid in self._faulted:
                status = "fault"
                vibration = self._rng.uniform(120, 200)
                temperature = self._rng.uniform(110, 150)
                current = self._rng.uniform(40, 60)
            else:
                status = "normal"
                vibration = self._rng.uniform(20, 80)
                temperature = self._rng.uniform(40, 90)
                current = self._rng.uniform(5, 30)
            machines[mid] = MachineState(
                vibration=round(vibration, 2),
                temperature=round(temperature, 2),
                current=round(current, 2),
                status=status,
            )

        robots = {}
        for rid in ROBOT_POSITIONS:
            pos = self._robot_positions[rid]
            robots[rid] = RobotState(
                x=round(pos[0], 2),
                y=round(pos[1], 2),
                heading=round(self._robot_headings[rid], 1),
                status=self._robot_statuses[rid],
            )

        return SensorSnapshot(
            ts=int(time.time() * 1000),
            machines=machines,
            robots=robots,
        )
