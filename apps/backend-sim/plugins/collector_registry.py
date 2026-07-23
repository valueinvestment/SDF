from dataclasses import dataclass
from simulator.models import MachineState
from plugins.contracts import Collector


@dataclass
class _CacheEntry:
    state: MachineState
    last_success: float
    poll_interval_sec: float


class CollectorRegistry:
    def __init__(self):
        self._collectors: dict[str, Collector] = {}
        self._owner: dict[str, str] = {}
        self._cache: dict[str, _CacheEntry] = {}

    def register(self, collector: Collector) -> None:
        if collector.id in self._collectors:
            raise ValueError(f"[CollectorRegistry] collector id already registered: {collector.id}")
        for mid in collector.machine_ids:
            if mid in self._owner:
                raise ValueError(
                    f"[CollectorRegistry] machine '{mid}' already owned by collector '{self._owner[mid]}'"
                )
        self._collectors[collector.id] = collector
        for mid in collector.machine_ids:
            self._owner[mid] = collector.id

    def get_cached_state(self, machine_id: str) -> MachineState | None:
        entry = self._cache.get(machine_id)
        if entry is None:
            return None
        return entry.state
