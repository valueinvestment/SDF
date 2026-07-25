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


def test_record_error_and_get_all_errors():
    registry = PipelineRegistry()
    registry.record_error("s1", "boom")
    errors = registry.get_all_errors()
    assert len(errors["s1"]) == 1
    assert errors["s1"][0].message == "boom"


def test_run_records_error_when_stage_throws():
    registry = PipelineRegistry()
    registry.register(BoomStage())
    registry.run("M1", make_state())
    errors = registry.get_all_errors()
    assert len(errors["boom"]) == 1
    assert "stage exploded" in errors["boom"][0].message


def test_get_all_errors_returns_a_copy_not_a_live_reference():
    from plugins.errors import PluginErrorEntry
    registry = PipelineRegistry()
    registry.record_error("s1", "boom")
    errors = registry.get_all_errors()
    errors["s1"].append(PluginErrorEntry(message="mutated", ts=999.0))
    assert len(registry.get_all_errors()["s1"]) == 1
