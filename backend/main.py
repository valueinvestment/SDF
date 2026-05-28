from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from gateway.ws_gateway import WebSocketGateway

app = FastAPI(title="SDF Digital Twin Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://*.vercel.app"],
    allow_methods=["*"],
    allow_headers=["*"],
)

gateway = WebSocketGateway()

@app.get("/health")
async def health():
    return {"status": "ok", "clients": gateway.client_count}

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await gateway.connect(ws)
    try:
        while True:
            await ws.receive_text()   # keep connection alive
    except WebSocketDisconnect:
        gateway.disconnect(ws)
