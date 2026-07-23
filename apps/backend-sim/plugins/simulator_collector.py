from simulator.models import MachineState
from simulator.sensor_simulator import SensorSimulator


class SimulatorCollector:
    """Wraps SensorSimulator as a Collector. machine_ids is a live property (not
    captured at construction) so machines added/removed at runtime via
    simulator.sync_entities() are picked up automatically on the next poll."""

    def __init__(self, simulator: SensorSimulator, id: str = "simulator", poll_interval_sec: float = 0.1):
        self.id = id
        self.poll_interval_sec = poll_interval_sec
        self._simulator = simulator

    @property
    def machine_ids(self) -> list[str]:
        return self._simulator.machine_ids

    async def collect(self) -> dict[str, MachineState]:
        snapshot = self._simulator.tick()
        return dict(snapshot.machines)
