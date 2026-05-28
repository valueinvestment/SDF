import json
from fastapi import WebSocket

class WebSocketGateway:
    def __init__(self):
        self._clients: set[WebSocket] = set()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._clients.add(ws)

    def disconnect(self, ws: WebSocket) -> None:
        self._clients.discard(ws)

    async def broadcast(self, message: dict) -> None:
        data = json.dumps(message)
        dead: set[WebSocket] = set()
        for client in self._clients:
            try:
                await client.send_text(data)
            except Exception:
                dead.add(client)
        self._clients -= dead

    @property
    def client_count(self) -> int:
        return len(self._clients)
