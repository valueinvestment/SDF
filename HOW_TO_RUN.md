# How to Run SDF Digital Twin

## Prerequisites

- **Node.js** 18+ and npm
- **Python** 3.11+
- **uv** — Python package manager (`pip install uv` or see [docs.astral.sh/uv](https://docs.astral.sh/uv))
- **Anthropic API key** — get one at [console.anthropic.com](https://console.anthropic.com)

---

## 1. Backend (FastAPI)

```bash
cd backend
```

Install dependencies (uv creates the virtual environment automatically):

```bash
uv sync
```

> **First time?** Install uv with `pip install uv` or see [docs.astral.sh/uv](https://docs.astral.sh/uv).

Set up environment variables — copy the example and fill in your key:

```bash
copy .env.example .env      # Windows
# cp .env.example .env      # macOS / Linux
```

Edit `.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Start the server:

```bash
uv run uvicorn main:app --reload
```

Backend runs at `http://localhost:8000`.  
WebSocket endpoint: `ws://localhost:8000/ws`

---

## ⚠️ Troubleshooting: 코드를 고쳤는데 반영이 안 될 때 (stale 프로세스)

증상: **WebSocket은 연결되는데 메시지가 안 오거나, 추가한 `print`/로그가 터미널에 안 찍힘.**

원인: `--reload`가 변경을 놓쳐(특히 Windows) **예전 코드를 그대로 돌리는 워커 프로세스가 살아남아** 있는 경우. uvicorn은 reloader + spawn된 워커(자식) 구조라, 워커가 orphan으로 남으면 8000 포트를 계속 잡고 옛 코드를 서빙합니다.

**1. 지금 떠 있는 서버가 새 코드인지 확인** — `started_at`/`pid`가 재시작 후에도 안 바뀌면 stale 입니다:

```bash
curl http://localhost:8000/health
# {"status":"ok","clients":1,"pid":12345,"gateway_id":...,"started_at":"2026-06-02 18:10:02"}
```

서버 시작 시 터미널에도 배너가 찍힙니다: `[startup] backend online — pid=... gateway_id=... started_at=...`

**2. 8000 포트를 잡은 프로세스를 자식 워커까지 전부 종료** (PowerShell):

```powershell
# spawn된 워커는 커맨드라인이 "multiprocessing.spawn" 이라 main:app 으로는 안 잡힘.
# 포트 점유 PID + 그 자식까지 트리로 종료
$pid8000 = (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue).OwningProcess
if ($pid8000) { taskkill /PID $pid8000 /T /F }
# 그래도 남으면 reloader 까지:
Get-CimInstance Win32_Process -Filter "name='python.exe'" |
  Where-Object { $_.CommandLine -like '*uvicorn*main:app*' } |
  ForEach-Object { taskkill /PID $_.ProcessId /T /F }
```

**3. 다시 띄우기.** `/health` 의 `started_at` 이 갱신됐는지 확인하세요.

> 로그가 즉시 안 보이는 건 reload 워커 stdout 버퍼링 탓입니다. 본 프로젝트의 디버그 `print` 는 `flush=True` 로 출력하며, 직접 추가할 때도 `print(..., flush=True)` 또는 `uv run` 앞에 `PYTHONUNBUFFERED=1` 을 권장합니다.

---

## 2. Frontend (Next.js)

Open a new terminal:

```bash
cd frontend
npm install
```

The dev WebSocket URL is already set in `frontend/.env.local`:

```
NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws
```

Start the dev server:

```bash
npm run dev
```

Frontend runs at `http://localhost:3000`.

---

## Running Both Together

1. Terminal 1 — start the backend (steps above).
2. Terminal 2 — start the frontend (steps above).
3. Open `http://localhost:3000` in a browser.

The frontend connects to the backend over WebSocket automatically. You should see the 3D factory floor and live sensor data within a few seconds.

---

## Tests

**Backend:**

```bash
cd backend
uv run pytest
```

**Frontend:**

```bash
cd frontend
npm test
```

---

## Production Deployment

| Service | Platform | Config file |
|---------|----------|-------------|
| Backend | Railway | `railway.toml` |
| Frontend | Vercel | `frontend/vercel.json` |

Set `ANTHROPIC_API_KEY` as an environment variable in your Railway service.  
Set `NEXT_PUBLIC_WS_URL` to your Railway backend WebSocket URL in Vercel.
