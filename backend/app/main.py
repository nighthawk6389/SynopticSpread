import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# Configure logging early so app.* loggers are visible in Render logs.
logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)-5s [%(name)s] %(message)s",
)

from app.config import settings
from app.routers import admin, alerts, divergence, forecasts

logger = logging.getLogger(__name__)

# Models to seed on startup (ECMWF requires an API key so it is conditional).
_SEED_MODELS = ["GFS", "NAM", "HRRR"]


async def _seed_initial_data():
    """Trigger ingestion for all models if the database has no runs yet.

    Called as a background task during startup so the server is already
    accepting requests while data is being fetched.
    """
    from sqlalchemy import func, select

    from app.database import async_session
    from app.models import ModelRun
    from app.services.scheduler import ingest_and_process

    # Brief pause so the server is fully ready before heavy work begins.
    await asyncio.sleep(2)

    async with async_session() as db:
        count = (await db.execute(select(func.count(ModelRun.id)))).scalar()

    if count and count > 0:
        logger.info("Database already has %d model run(s) — skipping seed.", count)
        return

    models = list(_SEED_MODELS)
    if settings.ecmwf_api_key:
        models.append("ECMWF")

    logger.info("Seeding initial data for models: %s", models)
    for model in models:
        try:
            await ingest_and_process(model)
        except Exception:
            logger.exception("Seed ingestion failed for %s", model)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure the data directory exists.
    settings.data_store_path.mkdir(parents=True, exist_ok=True)

    # Log the final database URL being used (redacted password).
    from app.config import _redact_url

    logger.info("Startup — DATABASE_URL: %s", _redact_url(settings.database_url))
    logger.info(
        "Startup — DATABASE_AUTO_CREATE=%s, SCHEDULER_ENABLED=%s, SEED_DATA_ON_STARTUP=%s",
        settings.database_auto_create,
        settings.scheduler_enabled,
        settings.seed_data_on_startup,
    )

    # Optionally create all ORM tables on first boot (set DATABASE_AUTO_CREATE=true
    # in production environments that don't use Alembic migrations).
    if settings.database_auto_create:
        from app.database import Base, engine

        # On managed platforms (e.g. Render) the database may still be
        # starting when the web service boots.  Retry with backoff.
        for attempt in range(5):
            try:
                logger.info("Attempting DB connection (attempt %d/5)…", attempt + 1)
                async with engine.begin() as conn:
                    await conn.run_sync(Base.metadata.create_all)
                logger.info("Database tables created successfully.")
                break
            except Exception as exc:
                logger.error(
                    "Database connection failed (attempt %d/5): %s", attempt + 1, exc
                )
                if attempt == 4:
                    raise
                wait = 2 ** attempt  # 1, 2, 4, 8, 16 s
                logger.warning(
                    "Database not ready — retrying in %ds",
                    wait,
                )
                await asyncio.sleep(wait)

    # Start the ingestion scheduler if enabled.
    if settings.scheduler_enabled:
        from app.services.scheduler import scheduler

        scheduler.start()

    # Kick off data seeding in the background so the app starts serving immediately.
    seed_task = None
    if settings.seed_data_on_startup:
        seed_task = asyncio.create_task(_seed_initial_data())

    yield

    if seed_task and not seed_task.done():
        seed_task.cancel()

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
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(forecasts.router, prefix="/api")
app.include_router(divergence.router, prefix="/api")
app.include_router(alerts.router, prefix="/api")
app.include_router(admin.router, prefix="/api")


@app.get("/api/health")
async def health():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Serve the compiled frontend (present in production Docker builds).
# In development Vite runs on its own port, so this directory won't exist.
# ---------------------------------------------------------------------------
_frontend_dist = Path(__file__).parent.parent / "frontend_dist"
if _frontend_dist.exists():
    app.mount("/", StaticFiles(directory=_frontend_dist, html=True), name="frontend")
