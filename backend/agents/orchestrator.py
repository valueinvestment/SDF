import asyncio
import time
import os
from anthropic import AsyncAnthropic
from gateway.event_bus import EventBus
from gateway.ws_gateway import WebSocketGateway
from simulator.sensor_simulator import SensorSimulator
from agents.agent_a import run_agent_a
from agents.agent_b import run_agent_b
from agents.agent_c import run_agent_c

class AgentOrchestrator:
    def __init__(self, bus: EventBus, gateway: WebSocketGateway, simulator: SensorSimulator):
        self._bus = bus
        self._gateway = gateway
        self._simulator = simulator
        self._client = AsyncAnthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))
        self._running = False

    async def start(self):
        q = self._bus.subscribe()
        self._running = True
        while self._running:
            event = await q.get()
            if event["type"] == "anomaly_detected":
                asyncio.create_task(self._run_chain(event["machineId"]))

    async def _emit(self, agent_id: str, status: str, summary: str = ""):
        await self._gateway.broadcast({
            "type": "agent_event",
            "payload": {
                "agentId": agent_id,
                "status": status,
                "summary": summary,
                "ts": int(time.time() * 1000),
            }
        })

    async def _run_chain(self, machine_id: str):
        await self._gateway.broadcast({
            "type": "alert",
            "payload": {"machineId": machine_id, "ts": int(time.time() * 1000)},
        })

        await self._emit("A", "running")
        snapshot = self._simulator.tick()
        history = [
            {"ts": snapshot.ts, "vibration": snapshot.machines[machine_id].vibration,
             "temperature": snapshot.machines[machine_id].temperature,
             "current": snapshot.machines[machine_id].current}
        ]
        report = await run_agent_a(machine_id, history, self._client)
        await self._emit("A", "complete" if not report.fallback else "error",
                         f"{report.classification} ({report.severity} severity, {report.confidence:.0%} confidence)")

        await self._emit("B", "running")
        robot_states = {rid: {"x": r.x, "y": r.y, "status": r.status}
                        for rid, r in snapshot.robots.items()}
        dispatch = await run_agent_b(machine_id, report, robot_states, self._client)
        await self._emit("B", "complete" if not dispatch.fallback else "error",
                         f"Dispatching {dispatch.robotId} → {machine_id} (ETA {dispatch.eta_seconds:.0f}s)")

        await self._gateway.broadcast({
            "type": "robot_dispatch",
            "payload": {
                "robotId": dispatch.robotId,
                "targetMachineId": machine_id,
                "path": dispatch.path,
                "estimatedArrival": dispatch.eta_seconds,
            }
        })

        await self._emit("C", "running")
        rice = await run_agent_c(machine_id, report, dispatch, self._client)
        await self._emit("C", "complete" if not rice.get("fallback") else "error",
                         f"Recommendation: {rice['recommendation']}. {rice.get('rationale','')[:120]}")
