from typing import Protocol, runtime_checkable
from simulator.models import MachineState


@runtime_checkable
class Collector(Protocol):
    id: str
    machine_ids: list[str]
    poll_interval_sec: float

    async def collect(self) -> dict[str, MachineState]:
        """Fetch the latest state for every machine this collector owns. Raise on failure."""
        ...


@runtime_checkable
class PipelineStage(Protocol):
    id: str

    def process(self, machine_id: str, state: MachineState) -> MachineState:
        """Called once per machine per tick. Pass state through unchanged if not relevant."""
        ...
