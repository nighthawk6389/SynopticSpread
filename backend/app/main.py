from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import divergence, forecasts


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: ensure data directory exists
    settings.data_store_path.mkdir(parents=True, exist_ok=True)

    # Start scheduler if enabled
    if settings.scheduler_enabled:
        from app.services.scheduler import scheduler

        scheduler.start()

    yield

    # Shutdown
    if settings.scheduler_enabled:
        from app.services.scheduler import scheduler

        scheduler.shutdown(wait=False)


app = FastAPI(
    title="SynopticSpread",
    description="Track NWP meteorological model divergence",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(forecasts.router, prefix="/api")
app.include_router(divergence.router, prefix="/api")


@app.get("/api/health")
async def health():
    return {"status": "ok"}
