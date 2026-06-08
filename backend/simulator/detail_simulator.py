import random
import time
from simulator.sensor_simulator import MACHINE_POSITIONS, ROBOT_POSITIONS

PARTS = ["body", "motor", "actuator", "sensor_unit"]

class DetailSimulator:
    def __init__(self, seed: int = 0):
        self._rng = random.Random(seed)
        self._base_wear: dict[str, dict[str, float]] = {
            mid: {p: self._rng.uniform(10, 70) for p in PARTS}
            for mid in MACHINE_POSITIONS
        }
        self._faulted_parts: dict[str, set[str]] = {mid: set() for mid in MACHINE_POSITIONS}
        self._robot_positions: dict[str, tuple[float, float]] = dict(ROBOT_POSITIONS)

    def inject_component_fault(self, machine_id: str, part: str) -> None:
        self._faulted_parts[machine_id].add(part)

    def clear_faults(self, machine_id: str) -> None:
        if machine_id in self._faulted_parts:
            self._faulted_parts[machine_id].clear()

    def sync_machines(self, machine_ids: list[str]) -> None:
        """Add newly tracked machines, remove untracked ones."""
        old = set(self._base_wear)
        new = set(machine_ids)
        for mid in new - old:
            self._base_wear[mid] = {p: self._rng.uniform(10, 70) for p in PARTS}
            self._faulted_parts[mid] = set()
        for mid in old - new:
            self._base_wear.pop(mid, None)
            self._faulted_parts.pop(mid, None)

    def sync_robots(self, robots: dict[str, tuple[float, float]]) -> None:
        """Add newly tracked robots, remove untracked ones."""
        self._robot_positions = dict(robots)

    def has_machine(self, machine_id: str) -> bool:
        return machine_id in self._base_wear

    def has_robot(self, robot_id: str) -> bool:
        return robot_id in self._robot_positions

    def get_machine_detail(self, machine_id: str) -> dict:
        now = time.time()
        components = {}
        for part in PARTS:
            base = self._base_wear[machine_id][part]
            wear = min(100.0, base + self._rng.uniform(-1, 1))
            faulted = part in self._faulted_parts[machine_id]
            if faulted:
                wear = min(100.0, wear + self._rng.uniform(20, 35))

            temp_base = 40 + wear * 0.8
            temp = temp_base + self._rng.uniform(-3, 3) + (30 if faulted else 0)

            if faulted or wear >= 85:
                status = "critical"
            elif wear >= 65:
                status = "warn"
            else:
                status = "ok"

            components[part] = {
                "wear": round(wear, 1),
                "temperature": round(temp, 1),
                "status": status,
            }

        thermal_grid = []
        for r in range(4):
            row = []
            for c in range(4):
                base_temp = sum(v["temperature"] for v in components.values()) / len(components)
                val = (base_temp - 40) / 120
                noise = self._rng.uniform(-0.1, 0.1)
                row.append(round(max(0.0, min(1.0, val + noise)), 2))
            thermal_grid.append(row)

        fault_count = len(self._faulted_parts[machine_id])
        operation_rate = max(0, 100 - fault_count * 25 + self._rng.uniform(-5, 5))

        return {
            "machineId": machine_id,
            "ts": int(now * 1000),
            "operationRate": round(operation_rate, 1),
            "components": components,
            "thermalGrid": thermal_grid,
        }

    def get_robot_path(self, robot_id: str) -> dict:
        pos = self._robot_positions.get(robot_id, (10.0, 10.0))
        patrol = [
            [pos[0], pos[1]],
            [pos[0] + 3, pos[1]],
            [pos[0] + 3, pos[1] + 3],
            [pos[0], pos[1] + 3],
            [pos[0], pos[1]],
        ]
        return {
            "robotId": robot_id,
            "currentPos": list(pos),
            "recommendedPath": patrol,
            "targetEntityId": None,
            "eta": 0,
            "pathType": "idle_patrol",
        }
