from pathlib import Path

from plugins.dynamic_loader import _load_module_from_path
from simulator.models import MachineState


def test_example_pipeline_stage_flags_high_vibration_and_passes_through_normal():
    repo_root = Path(__file__).resolve().parents[3]
    example_path = repo_root / "examples" / "plugins" / "example_pipeline_stage.py"
    module = _load_module_from_path(example_path)
    stage = module.pipeline_stages[0]

    normal_state = MachineState(vibration=40.0, temperature=60.0, current=10.0, status="normal")
    assert stage.process("M1", normal_state).status == "normal"

    high_vibration_state = MachineState(vibration=70.0, temperature=60.0, current=10.0, status="normal")
    result = stage.process("M1", high_vibration_state)
    assert result.status == "fault"
    assert result.vibration == 70.0
    assert result.temperature == 60.0
    assert result.current == 10.0

    already_faulted_state = MachineState(vibration=70.0, temperature=60.0, current=10.0, status="fault")
    assert stage.process("M1", already_faulted_state).status == "fault"  # unchanged, not re-processed differently
