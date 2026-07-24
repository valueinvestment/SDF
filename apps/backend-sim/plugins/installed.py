"""Static plugin registration — the only file a plugin author needs to edit to
add a Collector or PipelineStage. Phase 4.5 will add an importlib-based dynamic
loader that calls CollectorRegistry.register()/PipelineRegistry.register() at
the same entry points used here, without changing this file's shape."""
from simulator.sensor_simulator import SensorSimulator
from plugins.contracts import Collector, PipelineStage
from plugins.simulator_collector import SimulatorCollector


def build_installed_collectors(simulator: SensorSimulator) -> list[Collector]:
    return [
        SimulatorCollector(simulator=simulator),
    ]


installed_pipeline_stages: list[PipelineStage] = []
