import sys

import pytest
from plugins.collector_registry import CollectorRegistry
from plugins.pipeline_registry import PipelineRegistry
from plugins.dynamic_loader import scan_and_load
from simulator.models import MachineState


class FakeCollector:
    def __init__(self, id, machine_ids):
        self.id = id
        self.machine_ids = machine_ids
        self.poll_interval_sec = 10.0

    async def collect(self):
        return {mid: MachineState(vibration=1.0, temperature=1.0, current=1.0, status="normal") for mid in self.machine_ids}


class FakePipelineStage:
    def __init__(self, id):
        self.id = id

    def process(self, machine_id, state):
        return state.model_copy(update={"status": "fault"})


COLLECTOR_FILE = '''
from simulator.models import MachineState


class FakeCollector:
    id = "dyn-c1"
    machine_ids = ["DYN-M1"]
    poll_interval_sec = 10.0

    async def collect(self):
        return {"DYN-M1": MachineState(vibration=1.0, temperature=1.0, current=1.0, status="normal")}


collectors = [FakeCollector()]
'''

PIPELINE_FILE = '''
class FakeStage:
    id = "dyn-stage1"

    def process(self, machine_id, state):
        return state.model_copy(update={"status": "fault"})


pipeline_stages = [FakeStage()]
'''

BROKEN_FILE = "this is not valid python :::"

BAD_SHAPE_COLLECTOR_FILE = '''
collectors = ["not a collector"]
'''

BAD_SHAPE_STAGE_FILE = '''
pipeline_stages = ["not a stage"]
'''

NON_LIST_COLLECTOR_FILE = '''
from simulator.models import MachineState


class FakeCollector:
    id = "dyn-c2"
    machine_ids = ["DYN-M2"]
    poll_interval_sec = 10.0

    async def collect(self):
        return {"DYN-M2": MachineState(vibration=1.0, temperature=1.0, current=1.0, status="normal")}


collectors = FakeCollector()  # forgot to wrap in a list
'''

NON_LIST_STAGE_FILE = '''
class FakeStage:
    id = "dyn-stage2"

    def process(self, machine_id, state):
        return state.model_copy(update={"status": "fault"})


pipeline_stages = FakeStage()  # forgot to wrap in a list
'''


@pytest.mark.asyncio
async def test_scan_and_load_noop_when_directory_missing(tmp_path):
    missing_dir = tmp_path / "does-not-exist"
    collector_registry = CollectorRegistry()
    pipeline_registry = PipelineRegistry()
    loaded: set[str] = set()

    await scan_and_load(missing_dir, collector_registry, pipeline_registry, loaded)  # must not raise


@pytest.mark.asyncio
async def test_scan_and_load_registers_and_primes_collector(tmp_path):
    collector_registry = CollectorRegistry()
    pipeline_registry = PipelineRegistry()
    loaded: set[str] = set()
    (tmp_path / "plugin1.py").write_text(COLLECTOR_FILE)

    await scan_and_load(tmp_path, collector_registry, pipeline_registry, loaded)

    cached = collector_registry.get_cached_state("DYN-M1")
    assert cached is not None
    assert cached.status == "normal"


@pytest.mark.asyncio
async def test_scan_and_load_registers_pipeline_stage(tmp_path):
    collector_registry = CollectorRegistry()
    pipeline_registry = PipelineRegistry()
    loaded: set[str] = set()
    (tmp_path / "stage1.py").write_text(PIPELINE_FILE)

    await scan_and_load(tmp_path, collector_registry, pipeline_registry, loaded)

    result = pipeline_registry.run(
        "M1", MachineState(vibration=1.0, temperature=1.0, current=1.0, status="normal")
    )
    assert result.status == "fault"


@pytest.mark.asyncio
async def test_scan_and_load_does_not_reprocess_already_loaded_files(tmp_path):
    collector_registry = CollectorRegistry()
    pipeline_registry = PipelineRegistry()
    loaded: set[str] = set()
    (tmp_path / "plugin1.py").write_text(COLLECTOR_FILE)

    await scan_and_load(tmp_path, collector_registry, pipeline_registry, loaded)
    await scan_and_load(tmp_path, collector_registry, pipeline_registry, loaded)

    assert collector_registry.get_all_errors() == {}  # no duplicate-id error from re-registering


@pytest.mark.asyncio
async def test_scan_and_load_skips_broken_file_without_raising(tmp_path):
    collector_registry = CollectorRegistry()
    pipeline_registry = PipelineRegistry()
    loaded: set[str] = set()
    (tmp_path / "broken.py").write_text(BROKEN_FILE)

    await scan_and_load(tmp_path, collector_registry, pipeline_registry, loaded)  # must not raise

    assert "broken.py" in loaded  # marked as attempted, won't be retried


@pytest.mark.asyncio
async def test_scan_and_load_skips_collector_entry_that_fails_protocol_check(tmp_path):
    collector_registry = CollectorRegistry()
    pipeline_registry = PipelineRegistry()
    loaded: set[str] = set()
    (tmp_path / "bad_shape.py").write_text(BAD_SHAPE_COLLECTOR_FILE)

    await scan_and_load(tmp_path, collector_registry, pipeline_registry, loaded)  # must not raise

    assert collector_registry.get_all_errors() == {}


@pytest.mark.asyncio
async def test_scan_and_load_skips_stage_entry_that_fails_protocol_check(tmp_path):
    collector_registry = CollectorRegistry()
    pipeline_registry = PipelineRegistry()
    loaded: set[str] = set()
    (tmp_path / "bad_shape.py").write_text(BAD_SHAPE_STAGE_FILE)

    await scan_and_load(tmp_path, collector_registry, pipeline_registry, loaded)  # must not raise

    assert pipeline_registry.get_all_errors() == {}


@pytest.mark.asyncio
async def test_scan_and_load_records_error_on_duplicate_collector_id(tmp_path):
    collector_registry = CollectorRegistry()
    pipeline_registry = PipelineRegistry()
    collector_registry.register(FakeCollector("dyn-c1", ["EXISTING-M1"]))  # same id as COLLECTOR_FILE below
    loaded: set[str] = set()
    (tmp_path / "plugin1.py").write_text(COLLECTOR_FILE)

    await scan_and_load(tmp_path, collector_registry, pipeline_registry, loaded)

    errors = collector_registry.get_all_errors()
    assert "dyn-c1" in errors
    assert "already registered" in errors["dyn-c1"][0].message


@pytest.mark.asyncio
async def test_scan_and_load_records_error_on_duplicate_pipeline_stage_id(tmp_path):
    collector_registry = CollectorRegistry()
    pipeline_registry = PipelineRegistry()
    pipeline_registry.register(FakePipelineStage("dyn-stage1"))  # same id as PIPELINE_FILE below
    loaded: set[str] = set()
    (tmp_path / "stage1.py").write_text(PIPELINE_FILE)

    await scan_and_load(tmp_path, collector_registry, pipeline_registry, loaded)

    errors = pipeline_registry.get_all_errors()
    assert "dyn-stage1" in errors
    assert "already registered" in errors["dyn-stage1"][0].message


@pytest.mark.asyncio
async def test_scan_and_load_handles_non_list_collectors_attribute_without_raising(tmp_path):
    collector_registry = CollectorRegistry()
    pipeline_registry = PipelineRegistry()
    loaded: set[str] = set()
    (tmp_path / "plugin2.py").write_text(NON_LIST_COLLECTOR_FILE)

    await scan_and_load(tmp_path, collector_registry, pipeline_registry, loaded)  # must not raise

    assert collector_registry.get_all_errors() == {}
    assert collector_registry.get_cached_state("DYN-M2") is None  # never registered, so never polled


@pytest.mark.asyncio
async def test_scan_and_load_handles_non_list_pipeline_stages_attribute_without_raising(tmp_path):
    collector_registry = CollectorRegistry()
    pipeline_registry = PipelineRegistry()
    loaded: set[str] = set()
    (tmp_path / "stage2.py").write_text(NON_LIST_STAGE_FILE)

    await scan_and_load(tmp_path, collector_registry, pipeline_registry, loaded)  # must not raise

    assert pipeline_registry.get_all_errors() == {}


@pytest.mark.asyncio
async def test_loaded_module_is_registered_in_sys_modules(tmp_path):
    collector_registry = CollectorRegistry()
    pipeline_registry = PipelineRegistry()
    loaded: set[str] = set()
    (tmp_path / "plugin1.py").write_text(COLLECTOR_FILE)

    await scan_and_load(tmp_path, collector_registry, pipeline_registry, loaded)

    assert "uploaded_plugin_plugin1" in sys.modules
