import asyncio
from typing import Any

class EventBus:
    def __init__(self):
        self._queues: list[asyncio.Queue] = []

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self._queues.append(q)
        return q

    async def publish(self, event: Any) -> None:
        for q in self._queues:
            await q.put(event)
