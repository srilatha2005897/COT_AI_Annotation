#!/usr/bin/env bash
# Start the AnnotateAI backend and frontend for local development.
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ultralytics/torch need Python 3.10-3.12 (no numpy<2 wheels for 3.13 yet).
PYTHON="$(command -v python3.12 || command -v python3.11 || command -v python3.10 || command -v python3)"
echo "Using $($PYTHON --version) for the backend"

echo "Starting backend on http://127.0.0.1:8000 ..."
(
  cd "$ROOT/backend"
  [ -d .venv ] || "$PYTHON" -m venv .venv
  ./.venv/bin/pip install -q --upgrade pip
  ./.venv/bin/pip install -q -r requirements.txt
  ./.venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
) &
BACKEND_PID=$!

echo "Starting frontend on http://127.0.0.1:5173 ..."
(
  cd "$ROOT/frontend"
  [ -d node_modules ] || npm install
  npm run dev -- --host 127.0.0.1 --port 5173
) &
FRONTEND_PID=$!

trap 'kill $BACKEND_PID $FRONTEND_PID 2>/dev/null' EXIT
wait
