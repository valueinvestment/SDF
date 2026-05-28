import json
from fastapi import WebSocket

class WebSocketGateway:
    def __init__(self):
        self._clients: set[WebSocket] = set()
        self._detail_subscriptions: dict[WebSocket, str] = {}

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._clients.add(ws)

    def disconnect(self, ws: WebSocket) -> None:
        self._clients.discard(ws)
        self._detail_subscriptions.pop(ws, None)

    async def handle_client_message(self, ws: WebSocket, raw: str) -> None:
        try:
            msg = json.loads(raw)
        except Exception:
            return
        if msg.get("type") == "subscribe_detail":
            self._detail_subscriptions[ws] = msg["payload"]["entityId"]
        elif msg.get("type") == "unsubscribe_detail":
            self._detail_subscriptions.pop(ws, None)

    async def broadcast(self, message: dict) -> None:
        data = json.dumps(message)
        dead: set[WebSocket] = set()
        for client in self._clients:
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
