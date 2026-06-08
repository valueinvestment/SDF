import random
import time
from simulator.models import MachineState, RobotState, SensorSnapshot

# Default positions — used as initial state and by DetailSimulator
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
        self._machine_positions: dict[str, tuple[float, float]] = dict(MACHINE_POSITIONS)
        self._robot_positions: dict[str, list[float]] = {k: list(v) for k, v in ROBOT_POSITIONS.items()}
        self._robot_headings: dict[str, float] = {k: 0.0 for k in ROBOT_POSITIONS}
        self._robot_statuses: dict[str, str] = {k: "idle" for k in ROBOT_POSITIONS}

    def inject_fault(self, machine_id: str) -> None:
        if machine_id in self._machine_positions:
            self._faulted.add(machine_id)

    def clear_fault(self, machine_id: str) -> None:
        self._faulted.discard(machine_id)

    def set_robot_status(self, robot_id: str, status: str) -> None:
        if robot_id in self._robot_statuses:
            self._robot_statuses[robot_id] = status

    def move_robot(self, robot_id: str, x: float, y: float) -> None:
        if robot_id in self._robot_positions:
            self._robot_positions[robot_id] = [x, y]

    def sync_entities(
        self,
        machines: dict[str, tuple[float, float]],
        robots: dict[str, tuple[float, float]],
    ) -> None:
        """Reconcile simulator state with the frontend entity list."""
        # Machines
        old_m = set(self._machine_positions)
        new_m = set(machines)
        for mid in new_m - old_m:
            self._machine_positions[mid] = machines[mid]
        for mid in old_m - new_m:
            del self._machine_positions[mid]
            self._faulted.discard(mid)
        for mid in old_m & new_m:
            self._machine_positions[mid] = machines[mid]

        # Robots
        old_r = set(self._robot_positions)
        new_r = set(robots)
        for rid in new_r - old_r:
            self._robot_positions[rid] = list(robots[rid])
            self._robot_headings[rid] = 0.0
            self._robot_statuses[rid] = "idle"
        for rid in old_r - new_r:
            self._robot_positions.pop(rid, None)
            self._robot_headings.pop(rid, None)
            self._robot_statuses.pop(rid, None)
        for rid in old_r & new_r:
            self._robot_positions[rid] = list(robots[rid])

    @property
    def machine_ids(self) -> list[str]:
        return list(self._machine_positions.keys())

    def tick(self) -> SensorSnapshot:
        machines = {}
        for mid in self._machine_positions:
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
        for rid in self._robot_positions:
            pos = self._robot_positions[rid]
            robots[rid] = RobotState(
                x=round(pos[0], 2),
                y=round(pos[1], 2),
                heading=round(self._robot_headings.get(rid, 0.0), 1),
                status=self._robot_statuses.get(rid, "idle"),
            )

        return SensorSnapshot(
            ts=int(time.time() * 1000),
            machines=machines,
            robots=robots,
        )
