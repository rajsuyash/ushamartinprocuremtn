FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir uv

# Manifests first for layer caching, then source.
COPY pyproject.toml uv.lock README.md ./
COPY src ./src

RUN uv sync --frozen --no-dev

EXPOSE 8000

CMD ["uv", "run", "uvicorn", "pdi_engine.main:app", "--host", "0.0.0.0", "--port", "8000"]
