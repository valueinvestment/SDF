# How to Run SDF Digital Twin

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 18+ | [nodejs.org](https://nodejs.org) |
| pnpm | 9+ | `npm install -g pnpm` |
| Python | 3.11+ | [python.org](https://python.org) |
| uv | latest | `pip install uv` |

Anthropic API key → [console.anthropic.com](https://console.anthropic.com)

---

## Project Structure

```
sdf-digital-twin/
├── apps/
│   ├── backend-sim/   ← FastAPI + WebSocket server
│   └── host-twin/     ← Next.js frontend
└── packages/          ← Shared types & SDK
```

---

## 1. Backend

```bash
cd apps/backend-sim
uv sync
```

Create `.env`:

```bash
copy .env.example .env    # Windows
cp .env.example .env      # macOS / Linux
```

Edit `.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Run:

```bash
uv run uvicorn main:app --reload
```

→ `http://localhost:8000` · WebSocket: `ws://localhost:8000/ws`

---

## 2. Frontend

New terminal — run from the **repo root**:

```bash
pnpm install
pnpm --filter @sdf/host-twin run dev
```

→ `http://localhost:3000`

> `NEXT_PUBLIC_WS_URL` defaults to `ws://localhost:8000/ws` in development.

---

## Tests

```bash
# Backend
cd apps/backend-sim && uv run pytest

# Frontend (from repo root)
pnpm --filter @sdf/host-twin run test
```

---

## Troubleshooting: stale uvicorn worker (Windows)

Symptom: WebSocket connects but no data, or code changes not reflected.

Cause: `--reload` on Windows can leave orphan worker processes holding port 8000.

**Verify** (check `started_at` / `pid` changed after restart):

```bash
curl http://localhost:8000/health
```

**Kill all workers** (PowerShell):

```powershell
$p = (Get-NetTCPConnection -LocalPort 8000 -State Listen -EA SilentlyContinue).OwningProcess
if ($p) { taskkill /PID $p /T /F }
```

**Restart** the server, then confirm `started_at` updated.

> Add `PYTHONUNBUFFERED=1` before `uv run` if print logs aren't appearing immediately.

---

## Production Deployment

### Frontend — Vercel

반드시 **repo root**에서 실행해야 합니다. (pnpm workspace 의존성 해소에 전체 모노레포가 필요)

```bash
# repo root 에서
npx vercel login          # 최초 1회
npx vercel deploy --prod --yes
```

Backend 배포 후 WebSocket URL 환경변수 설정:

```bash
# repo root 에서
npx vercel env add NEXT_PUBLIC_WS_URL production
# wss://<your-railway-app>.up.railway.app/ws
npx vercel deploy --prod --yes
```

> `apps/host-twin` 하위에서 `vercel deploy`를 실행하면 `workspace:*` 의존성을 해소할 수 없어 `npm install` 오류가 발생합니다.

### Backend — Railway

```bash
npm install -g @railway/cli
railway login

cd apps/backend-sim
railway init
railway variables set ANTHROPIC_API_KEY=sk-ant-...
railway up
```

Railway dashboard settings:
- **Root Directory:** `apps/backend-sim`
- **Start Command:** `uv run uvicorn main:app --host 0.0.0.0 --port $PORT`

---

## Live URLs

| Service | URL |
|---------|-----|
| Frontend | https://sdf-digital-twin.vercel.app |
| Backend | TBD after Railway deploy |
