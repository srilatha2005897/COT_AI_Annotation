@echo off
echo ================================
echo  AnnotateAI - local dev stack
echo ================================
echo.

start "AnnotateAI Backend" cmd /k "cd /d %~dp0backend && (if not exist .venv python -m venv .venv) && .venv\Scripts\pip install -q -r requirements.txt && .venv\Scripts\uvicorn app.main:app --reload --host 127.0.0.1 --port 8000"

timeout /t 3 /nobreak >nul

start "AnnotateAI Frontend" cmd /k "cd /d %~dp0frontend && (if not exist node_modules npm install) && npm run dev -- --host 127.0.0.1 --port 5173"

echo Backend:  http://127.0.0.1:8000/docs
echo Frontend: http://127.0.0.1:5173
echo.
echo Note: use Python 3.10-3.12 (not 3.13) for the backend.
pause
