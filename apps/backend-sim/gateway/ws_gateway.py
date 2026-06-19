import json
from fastapi import WebSocket

class WebSocketGateway:
    def __init__(self, simulator=None, detail_sim=None):
        self._clients: set[WebSocket] = set()
        self._detail_subscriptions: dict[WebSocket, str] = {}
        self._simulator = simulator
        self._detail_sim = detail_sim
        # entity_id → "machine" | "robot"
        self._entity_registry: dict[str, str] = {}

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._clients.add(ws)
        print(f"[gateway] connect id={id(self)} clients={len(self._clients)}", flush=True)

    def disconnect(self, ws: WebSocket) -> None:
        self._clients.discard(ws)
        self._detail_subscriptions.pop(ws, None)

    async def handle_client_message(self, ws: WebSocket, raw: str) -> None:
        try:
            msg = json.loads(raw)
        except Exception:
            return
        t = msg.get("type")
        if t == "subscribe_detail":
            self._detail_subscriptions[ws] = msg["payload"]["entityId"]
        elif t == "unsubscribe_detail":
            self._detail_subscriptions.pop(ws, None)
        elif t == "sync_entities":
            self._handle_sync_entities(msg.get("payload", {}))

    def _handle_sync_entities(self, payload: dict) -> None:
        if not self._simulator:
            return
        entities = payload.get("entities", [])
        machines: dict[str, tuple[float, float]] = {}
        robots: dict[str, tuple[float, float]] = {}
        for e in entities:
            if e.get("category") == "machine":
                machines[e["id"]] = (float(e["x"]), float(e["z"]))
            elif e.get("category") == "robot":
                robots[e["id"]] = (float(e["x"]), float(e["z"]))
        self._simulator.sync_entities(machines, robots)
        if self._detail_sim:
            self._detail_sim.sync_machines(list(machines.keys()))
            self._detail_sim.sync_robots(robots)
        self._entity_registry = {
            **{mid: "machine" for mid in machines},
            **{rid: "robot" for rid in robots},
        }
        print(
            f"[gateway] sync_entities machines={list(machines)} robots={list(robots)}",
            flush=True,
        )

    def get_entity_category(self, entity_id: str) -> str | None:
        """Return 'machine' or 'robot', or None if unknown."""
        cat = self._entity_registry.get(entity_id)
        if cat:
            return cat
        # Fallback for IDs not yet synced (legacy M/R prefix)
        if entity_id.startswith("M"):
            return "machine"
        if entity_id.startswith("R"):
            return "robot"
        return None

    async def broadcast(self, message: dict) -> None:
        try:
            data = json.dumps(message)
        except Exception as e:
            print(f"[broadcast] json.dumps failed: {e}", flush=True)
            return
        dead: set[WebSocket] = set()
        for client in list(self._clients):
            try:
                await client.send_text(data)
            except Exception:
                dead.add(client)
        self._clients -= dead

    async def broadcast_detail(self, entity_id: str, message: dict) -> None:
        """Send only to clients subscribed to entity_id"""
        data = json.dumps(message)
        dead: set[WebSocket] = set()
        for ws, eid in list(self._detail_subscriptions.items()):
            if eid == entity_id:
                try:
                    await ws.send_text(data)
                except Exception:
                    dead.add(ws)
        for ws in dead:
            self._clients.discard(ws)
            self._detail_subscriptions.pop(ws, None)

    @property
    def client_count(self) -> int:
        return len(self._clients)
