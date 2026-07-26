import time

from plugins.contracts import PipelineStage
from plugins.errors import PluginErrorEntry
from simulator.models import MachineState


class PipelineRegistry:
    def __init__(self):
        self._stages: list[PipelineStage] = []
        self._ids: set[str] = set()
        self._errors: dict[str, list[PluginErrorEntry]] = {}

    def register(self, stage: PipelineStage) -> None:
        if stage.id in self._ids:
            raise ValueError(f"[PipelineRegistry] pipeline stage id already registered: {stage.id}")
        self._ids.add(stage.id)
        self._stages.append(stage)

    def record_error(self, plugin_id: str, message: str) -> None:
        self._errors.setdefault(plugin_id, []).append(PluginErrorEntry(message=message, ts=time.time()))

    def get_all_errors(self) -> dict[str, list[PluginErrorEntry]]:
        return {k: list(v) for k, v in self._errors.items()}

    def run(self, machine_id: str, state: MachineState) -> MachineState:
        for stage in self._stages:
            try:
                state = stage.process(machine_id, state)
            except Exception as e:
                print(
                    f"[PipelineRegistry] stage '{stage.id}' failed for machine '{machine_id}': {e}",
                    flush=True,
                )
                self.record_error(stage.id, str(e))
        return state
