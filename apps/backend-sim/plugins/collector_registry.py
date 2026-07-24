import asyncio
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
        self._tasks: dict[str, asyncio.Task] = {}

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

    async def prime_all(self) -> None:
        for cid in list(self._collectors):
            await self.poll_once(cid)

    def start_all(self) -> None:
        for cid, collector in self._collectors.items():
            if cid not in self._tasks:
                self._tasks[cid] = asyncio.create_task(self._run_loop(collector))

    async def _run_loop(self, collector: Collector) -> None:
        while True:
            await asyncio.sleep(collector.poll_interval_sec)
            await self.poll_once(collector.id)

    def stop_all(self) -> None:
        for task in self._tasks.values():
            task.cancel()
        self._tasks.clear()

    def get_cached_state(self, machine_id: str) -> MachineState | None:
        entry = self._cache.get(machine_id)
        if entry is None:
            return None
        if time.time() - entry.last_success > 3 * entry.poll_interval_sec:
            return entry.state.model_copy(update={"status": "offline"})
        return entry.state
