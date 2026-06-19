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

# 워커가 (재)임포트될 때마다 갱신 — /health 의 started_at 이 안 바뀌면 stale 프로세스라는 신호
STARTED_AT = time.strftime("%Y-%m-%d %H:%M:%S")

bus = EventBus()
simulator = SensorSimulator(seed=int(time.time()))
detail_sim = DetailSimulator(seed=42)
gateway = WebSocketGateway(simulator, detail_sim)
orchestrator = AgentOrchestrator(bus, gateway, simulator, detail_sim)

async def simulation_loop():
    next_fault_at = time.time() + random.uniform(60, 120)
    faulted_machine = None
    while True:
        try:
            now = time.time()
            if faulted_machine is None and now >= next_fault_at:
                machine_ids = simulator.machine_ids
                if not machine_ids:
                    next_fault_at = now + random.uniform(60, 120)
                    await asyncio.sleep(0.1)
                    continue
                faulted_machine = random.choice(machine_ids)
                simulator.inject_fault(faulted_machine)
                await bus.publish({"type": "anomaly_detected", "machineId": faulted_machine})
            if faulted_machine and now >= next_fault_at + 30:
                simulator.clear_fault(faulted_machine)
                detail_sim.clear_faults(faulted_machine)
                faulted_machine = None
                next_fault_at = now + random.uniform(60, 120)
            snapshot = simulator.tick()
            msg = {"type": "sensor_update", "payload": snapshot.model_dump()}
            await gateway.broadcast(msg)          # direct — no bus middleman
            await bus.publish(msg)                # still notify orchestrator
        except Exception as e:
            print(f"[simulation_loop] error: {e}", flush=True)
        await asyncio.sleep(0.1)

async def broadcast_loop():
    q = bus.subscribe()
    while True:
        try:
            await q.get()  # drain bus; sensor_update is already broadcast directly in simulation_loop
        except Exception as e:
            print(f"[broadcast_loop] error: {e}", flush=True)

async def detail_loop():
    """Stream detail data at 2Hz to subscribed clients"""
    while True:
        subscribed = set(gateway._detail_subscriptions.values())
        for entity_id in subscribed:
            category = gateway.get_entity_category(entity_id)
            if category == "machine" and detail_sim.has_machine(entity_id):
                detail = detail_sim.get_machine_detail(entity_id)
                await gateway.broadcast_detail(entity_id, {
                    "type": "machine_detail",
                    "payload": detail,
                })
            elif category == "robot" and detail_sim.has_robot(entity_id):
                path = detail_sim.get_robot_path(entity_id)
                await gateway.broadcast_detail(entity_id, {
                    "type": "robot_path",
                    "payload": path,
                })
        await asyncio.sleep(0.5)

@asynccontextmanager
async def lifespan(app):
    # 시작 배너: 재시작이 실제로 새 코드로 떴는지 한눈에 확인 (pid/gateway id/시각)
    print(
        f"[startup] backend online - pid={os.getpid()} gateway_id={id(gateway)} started_at={STARTED_AT}",
        flush=True,
    )
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
    # pid/gateway_id/started_at 으로 stale 프로세스 여부를 즉시 판별 가능
    return {
        "status": "ok",
        "clients": gateway.client_count,
        "pid": os.getpid(),
        "gateway_id": id(gateway),
        "started_at": STARTED_AT,
    }

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await gateway.connect(ws)
    try:
        while True:
            raw = await ws.receive_text()
            await gateway.handle_client_message(ws, raw)
    except WebSocketDisconnect:
        gateway.disconnect(ws)
