import asyncio
import importlib.util
import sys
from pathlib import Path

from plugins.contracts import Collector, PipelineStage
from plugins.collector_registry import CollectorRegistry
from plugins.pipeline_registry import PipelineRegistry


def _load_module_from_path(path: Path):
    spec = importlib.util.spec_from_file_location(f"uploaded_plugin_{path.stem}", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


async def scan_and_load(
    directory: Path,
    collector_registry: CollectorRegistry,
    pipeline_registry: PipelineRegistry,
    loaded: set[str],
) -> None:
    """Scans `directory` for .py files not yet in `loaded` and registers any
    `collectors`/`pipeline_stages` module-level lists they declare. Every attempted
    filename is added to `loaded` regardless of outcome — editing an already-loaded
    file has no effect until the file is renamed or the server restarts (`loaded`
    resets to empty on restart, so a fresh process re-processes everything in the
    folder). Hot-reload-on-edit is a deliberate non-goal; see the design doc."""
    if not directory.exists():
        return
    for path in sorted(directory.glob("*.py")):
        if path.name in loaded:
            continue
        loaded.add(path.name)
        try:
            module = _load_module_from_path(path)
        except Exception as e:
            print(f"[dynamic_loader] failed to import {path.name}: {e}", flush=True)
            continue

        collectors = getattr(module, "collectors", [])
        if not isinstance(collectors, (list, tuple)):
            print(f"[dynamic_loader] {path.name}: 'collectors' must be a list, got {type(collectors).__name__}", flush=True)
            collectors = []
        for collector in collectors:
            if not isinstance(collector, Collector):
                print(f"[dynamic_loader] {path.name}: collectors entry is not a valid Collector", flush=True)
                continue
            try:
                collector_registry.register(collector)
                await collector_registry.poll_once(collector.id)
            except Exception as e:
                collector_registry.record_error(collector.id, str(e))

        pipeline_stages = getattr(module, "pipeline_stages", [])
        if not isinstance(pipeline_stages, (list, tuple)):
            print(f"[dynamic_loader] {path.name}: 'pipeline_stages' must be a list, got {type(pipeline_stages).__name__}", flush=True)
            pipeline_stages = []
        for stage in pipeline_stages:
            if not isinstance(stage, PipelineStage):
                print(f"[dynamic_loader] {path.name}: pipeline_stages entry is not a valid PipelineStage", flush=True)
                continue
            try:
                pipeline_registry.register(stage)
            except Exception as e:
                pipeline_registry.record_error(stage.id, str(e))

    collector_registry.start_all()  # idempotent — only starts tasks for newly-registered collectors


async def dynamic_loader_loop(
    directory: Path,
    collector_registry: CollectorRegistry,
    pipeline_registry: PipelineRegistry,
    interval_sec: float = 5.0,
) -> None:
    """Background task: calls scan_and_load() on a timer for the process lifetime."""
    directory.mkdir(parents=True, exist_ok=True)
    loaded: set[str] = set()
    while True:
        try:
            await scan_and_load(directory, collector_registry, pipeline_registry, loaded)
        except Exception as e:
            print(f"[dynamic_loader] scan_and_load failed: {e}", flush=True)
        await asyncio.sleep(interval_sec)
