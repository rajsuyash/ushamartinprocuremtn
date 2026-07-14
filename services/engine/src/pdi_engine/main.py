"""PDI engine FastAPI application."""
import asyncio
from contextlib import asynccontextmanager

import psycopg
from fastapi import FastAPI
from fastapi.responses import JSONResponse

from .api.simulate import router as simulate_router
from .api.stages import router as stages_router
from .config import get_settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    get_settings()  # fail fast at startup on missing env (MISSING_ENV: DATABASE_URL)
    yield


app = FastAPI(
    title="PDI Engine",
    description="Procurement Decision Intelligence analytics engine",
    version="0.1.0",
    lifespan=lifespan,
)

app.include_router(stages_router)
app.include_router(simulate_router)


def _db_ping(database_url: str) -> bool:
    try:
        with psycopg.connect(database_url, autocommit=True, connect_timeout=3) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
        return True
    except Exception:
        return False


async def check_database_connection() -> bool:
    """Check if the database is accessible without blocking the event loop."""
    return await asyncio.to_thread(_db_ping, get_settings().database_url)


@app.get("/health")
async def health_check() -> JSONResponse:
    """Health check endpoint that verifies database connectivity.

    Returns 200 with connected status if DB is healthy, 500 if unreachable.
    """
    db_connected = await check_database_connection()

    if db_connected:
        return JSONResponse(
            status_code=200,
            content={"status": "ok", "db": "connected"},
        )
    else:
        return JSONResponse(
            status_code=500,
            content={"status": "error", "db": "unreachable"},
        )
