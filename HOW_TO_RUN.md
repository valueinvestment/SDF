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

## Plugins

### Scaffold a new frontend plugin

```bash
pnpm create-plugin temperature-alert
```

Generates `apps/host-twin/plugins/temperatureAlertPlugin.tsx` (+ a smoke test in `plugins/__tests__/`) and auto-registers it in `apps/host-twin/lib/plugins.ts`. Backend plugins (`Collector`/`PipelineStage`) have no scaffold script yet — for a `Collector` implementation to model against, read `apps/backend-sim/plugins/simulator_collector.py` (the production one, statically registered in `installed.py`); for a `PipelineStage` you can drop straight into the dynamic-loading flow below without touching `installed.py`, copy `examples/plugins/example_pipeline_stage.py` (written specifically as an `uploaded/`-folder demo).

### Test frontend dynamic loading (dev-only)

1. Run the frontend in dev mode (`NODE_ENV` is not `production`, so the Plugin Inspector panel is visible).
2. Open the Plugin Inspector panel and drag a `.js` file onto the upload zone — try `examples/plugins/machine-counter-plugin.js`.
3. The file loads via native browser `import()` with zero rebuild. It must `export default` a plain `{id, name, version, activate}` object and cannot use bare-specifier imports (no bundler involved) — see `CONTRIBUTING.md` for the full contract.

### Test backend dynamic loading

1. With the backend running, drop a `.py` file implementing the `Collector` or `PipelineStage` protocol (`apps/backend-sim/plugins/contracts.py`) into `apps/backend-sim/plugins/uploaded/`.
2. A background poller picks it up within 5 seconds and registers it — check the Plugin Inspector panel or server logs for confirmation.
3. Files in this directory are gitignored (`apps/backend-sim/plugins/uploaded/*.py`) — don't commit test uploads there.

### Demo mode (no backend required)

Toggle via the "데모 컨트롤러" panel's start/stop button, or it auto-activates whenever the WebSocket isn't `"connected"` (frontend-only mock data generator, no backend needed).

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
