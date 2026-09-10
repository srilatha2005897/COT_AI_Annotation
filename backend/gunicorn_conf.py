"""Gunicorn config for production.

Run with:  gunicorn -c gunicorn_conf.py app.main:app
"""
import os

bind = os.getenv("BIND", "0.0.0.0:8000")

# Each worker loads its own YOLO model, so keep this small on a CPU-only box.
# Override with WEB_CONCURRENCY.
workers = int(os.getenv("WEB_CONCURRENCY", "2"))
worker_class = "uvicorn.workers.UvicornWorker"

# Detection requests can take a few seconds; give them room.
timeout = int(os.getenv("WORKER_TIMEOUT", "120"))
graceful_timeout = 30
keepalive = 5

accesslog = "-"
errorlog = "-"
loglevel = os.getenv("LOG_LEVEL", "info").lower()
