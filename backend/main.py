from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import asyncio
import random
import time
import os
from dotenv import load_dotenv
from gateway.event_bus import EventBus
from gateway.ws_gateway import WebSocketGateway
from simulator.sensor_simulator import SensorSimulator
from simulator.detail_simulator import DetailSimulator
from agents.orchestrator import AgentOrchestrator

load_dotenv()

bus = EventBus()
gateway = WebSocketGateway()
simulator = SensorSimulator(seed=int(time.time()))
detail_sim = DetailSimulator(seed=42)
orchestrator = AgentOrchestrator(bus, gateway, simulator, detail_sim)

async def simulation_loop():
    next_fault_at = time.time() + random.uniform(60, 120)
    faulted_machine = None
    while True:
        now = time.time()
        if faulted_machine is None and now >= next_fault_at:
            faulted_machine = random.choice(["M1", "M2", "M3", "M4", "M5"])
            simulator.inject_fault(faulted_machine)
            await bus.publish({"type": "anomaly_detected", "machineId": faulted_machine})
        if faulted_machine and now >= next_fault_at + 30:
            simulator.clear_fault(faulted_machine)
            detail_sim.clear_faults(faulted_machine)
            faulted_machine = None
            next_fault_at = now + random.uniform(60, 120)
        snapshot = simulator.tick()
        await bus.publish({"type": "sensor_update", "payload": snapshot.model_dump()})
        await asyncio.sleep(0.1)

async def broadcast_loop():
    q = bus.subscribe()
    while True:
        event = await q.get()
        if event["type"] == "sensor_update":
            await gateway.broadcast(event)

async def detail_loop():
    """Stream detail data at 2Hz to subscribed clients"""
    while True:
        subscribed = set(gateway._detail_subscriptions.values())
        for entity_id in subscribed:
            if entity_id.startswith("M"):
                detail = detail_sim.get_machine_detail(entity_id)
                await gateway.broadcast_detail(entity_id, {
                    "type": "machine_detail",
                    "payload": detail,
                })
            elif entity_id.startswith("R"):
                path = detail_sim.get_robot_path(entity_id)
                await gateway.broadcast_detail(entity_id, {
                    "type": "robot_path",
                    "payload": path,
                })
        await asyncio.sleep(0.5)

@asynccontextmanager
async def lifespan(app):
    tasks = [
        asyncio.create_task(simulation_loop()),
        asyncio.create_task(broadcast_loop()),
        asyncio.create_task(orchestrator.start()),
        asyncio.create_task(detail_loop()),
    ]
    yield
    for t in tasks:
        t.cancel()

app = FastAPI(title="SDF Digital Twin Backend", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://*.vercel.app"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {"status": "ok", "clients": gateway.client_count}

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await gateway.connect(ws)
    try:
        while True:
            raw = await ws.receive_text()
            await gateway.handle_client_message(ws, raw)
    except WebSocketDisconnect:
        gateway.disconnect(ws)
