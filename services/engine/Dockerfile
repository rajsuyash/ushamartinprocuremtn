FROM python:3.12-slim

WORKDIR /app

# libgomp1: OpenMP runtime required by LightGBM at import time
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

# Manifests first for layer caching, then source.
COPY pyproject.toml uv.lock README.md ./
COPY src ./src

RUN uv sync --frozen --no-dev

EXPOSE 8000

# Bind host is env-driven: docker compose uses the IPv4 default; Railway private
# networking is IPv6-only, so its deploy sets UVICORN_HOST="::".
CMD ["sh", "-c", "uv run uvicorn pdi_engine.main:app --host ${UVICORN_HOST:-0.0.0.0} --port 8000"]
