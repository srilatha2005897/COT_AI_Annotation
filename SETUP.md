# Running AnnotateAI on your machine

Two servers must be running: the Python backend on port **8000** and the React
frontend on port **5173**. You use the app at the frontend address.

## 1. Install these first

- **Python 3.12** (3.10 and 3.11 are fine, **not 3.13** — the YOLO library needs
  an older numpy that has no 3.13 build)
  - Mac `brew install python@3.12` · Ubuntu `sudo apt install python3.12 python3.12-venv`
  - Windows: download from python.org
- **Node 20 or newer** — check with `node -v`

The first install downloads PyTorch, about **1.5 GB**. After that it works
offline; the YOLO model file is already in `backend/`.

## 2. Start it

```bash
./start.sh        # Mac / Linux
start.bat         # Windows
```

That installs everything and starts both servers. When the output stops
scrolling, open **<http://127.0.0.1:5173>**.

**Or by hand,** in two terminals:

```bash
# Terminal 1 — backend
cd backend
python3.12 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

```bash
# Terminal 2 — frontend
cd frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

Wait for `Application startup complete`, then check
<http://127.0.0.1:8000/api/health> — it should say `{"status":"ok"}`. The
warnings about `TOKEN_SECRET` and `ADMIN_SETUP_KEY` are normal on your own
machine.

Stop either server with `Ctrl+C`.

