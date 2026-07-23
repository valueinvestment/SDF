import pytest
from plugins.pipeline_registry import PipelineRegistry
from simulator.models import MachineState


def make_state(status="normal", temperature=60.0):
    return MachineState(vibration=50.0, temperature=temperature, current=10.0, status=status)


class DoublingStage:
    id = "doubler"

    def process(self, machine_id, state):
        return state.model_copy(update={"vibration": state.vibration * 2})


class ThresholdFaultStage:
    id = "threshold-fault"

    def process(self, machine_id, state):
        if state.temperature > 100:
            return state.model_copy(update={"status": "fault"})
        return state


class BoomStage:
    id = "boom"

    def process(self, machine_id, state):
        raise RuntimeError("stage exploded")


def test_register_rejects_duplicate_stage_id():
    registry = PipelineRegistry()
    registry.register(DoublingStage())
    with pytest.raises(ValueError, match="pipeline stage id already registered"):
        registry.register(DoublingStage())


def test_run_applies_stages_in_registration_order():
    registry = PipelineRegistry()
    registry.register(DoublingStage())
    registry.register(ThresholdFaultStage())
    result = registry.run("M1", make_state(temperature=120.0))
    assert result.vibration == 100.0
    assert result.status == "fault"


def test_run_isolates_a_throwing_stage_and_passes_pre_stage_state_through():
    registry = PipelineRegistry()
    registry.register(BoomStage())
    registry.register(DoublingStage())
    result = registry.run("M1", make_state())
    assert result.vibration == 100.0  # doubler still ran despite boom stage failing


def test_run_failure_on_one_machine_does_not_affect_another():
    class FailsOnlyForM1:
        id = "fails-m1"

        def process(self, machine_id, state):
            if machine_id == "M1":
                raise RuntimeError("boom")
            return state.model_copy(update={"vibration": state.vibration + 1})

    registry = PipelineRegistry()
    registry.register(FailsOnlyForM1())
    result_m1 = registry.run("M1", make_state())
    result_m2 = registry.run("M2", make_state())
    assert result_m1.vibration == 50.0
    assert result_m2.vibration == 51.0
