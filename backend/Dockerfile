FROM python:3.12-slim

# OpenCV / Ultralytics runtime libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# Runs migrations, then the app under gunicorn.
CMD ["sh", "-c", "alembic upgrade head && gunicorn -c gunicorn_conf.py app.main:app"]
