from plugins.contracts import PipelineStage
from simulator.models import MachineState


class PipelineRegistry:
    def __init__(self):
        self._stages: list[PipelineStage] = []
        self._ids: set[str] = set()

    def register(self, stage: PipelineStage) -> None:
        if stage.id in self._ids:
            raise ValueError(f"[PipelineRegistry] pipeline stage id already registered: {stage.id}")
        self._ids.add(stage.id)
        self._stages.append(stage)

    def run(self, machine_id: str, state: MachineState) -> MachineState:
        for stage in self._stages:
            try:
                state = stage.process(machine_id, state)
            except Exception as e:
                print(
                    f"[PipelineRegistry] stage '{stage.id}' failed for machine '{machine_id}': {e}",
                    flush=True,
                )
        return state
