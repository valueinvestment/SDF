import time
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

    async def poll_once(self, collector_id: str) -> None:
        collector = self._collectors[collector_id]
        try:
            states = await collector.collect()
        except Exception as e:
            print(f"[CollectorRegistry] collector '{collector.id}' collect() failed: {e}", flush=True)
            return
        now = time.time()
        for mid, state in states.items():
            self._cache[mid] = _CacheEntry(
                state=state, last_success=now, poll_interval_sec=collector.poll_interval_sec
            )

    def get_cached_state(self, machine_id: str) -> MachineState | None:
        entry = self._cache.get(machine_id)
        if entry is None:
            return None
        return entry.state
