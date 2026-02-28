"""Admin endpoints for manual triggering of ingestion and processing."""

import logging
import shutil
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, func, select

from app.config import settings
from app.database import async_session
from app.models import GridSnapshot, ModelPointValue, ModelRun, PointMetric
from app.services.scheduler import _latest_cycle

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])

VALID_MODELS = {"GFS", "NAM", "ECMWF", "HRRR"}


class TriggerRequest(BaseModel):
    model: str
    init_time: datetime | None = None  # defaults to latest available cycle
    force: bool = False  # bypass idempotent check and re-ingest


class TriggerResponse(BaseModel):
    model: str
    init_time: str
    status: str
    message: str


async def _run_ingestion(model: str, init_time: datetime, force: bool = False):
    from app.services.scheduler import ingest_and_process

    logger.info("Manual trigger: %s %s (force=%s)", model, init_time, force)
    await ingest_and_process(model, init_time, force=force)


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------


@router.get("/status", summary="Current state of runs, metrics, and snapshots")
async def get_status():
    async with async_session() as db:
        run_count = (await db.execute(select(func.count(ModelRun.id)))).scalar()
        metric_count = (await db.execute(select(func.count(PointMetric.id)))).scalar()
        snapshot_count = (
            await db.execute(select(func.count(GridSnapshot.id)))
        ).scalar()

        runs = (
            (
                await db.execute(
                    select(ModelRun).order_by(ModelRun.created_at.desc()).limit(10)
                )
            )
            .scalars()
            .all()
        )

    zarr_dir = settings.data_store_path / "divergence"
    zarr_files = list(zarr_dir.rglob("*.zarr")) if zarr_dir.exists() else []

    return {
        "runs": run_count,
        "point_metrics": metric_count,
        "grid_snapshots": snapshot_count,
        "zarr_files_on_disk": len(zarr_files),
        "recent_runs": [
            {
                "model": r.model_name,
                "init_time": r.init_time.isoformat(),
                "forecast_hours": r.forecast_hours,
                "status": r.status,
            }
            for r in runs
        ],
    }


# ---------------------------------------------------------------------------
# Trigger
# ---------------------------------------------------------------------------


@router.post("/trigger", response_model=TriggerResponse)
async def trigger_ingestion(req: TriggerRequest, background_tasks: BackgroundTasks):
    """Manually trigger ingestion + divergence computation for a model.

    Runs in the background. Poll GET /api/runs or GET /api/admin/status for progress.
    If init_time is omitted, uses the most recent 6-hour cycle.
    """
    model = req.model.upper()
    if model not in VALID_MODELS:
        raise HTTPException(400, f"model must be one of {sorted(VALID_MODELS)}")

    if req.init_time:
        init_time = req.init_time
    else:
        init_time = _latest_cycle()
    background_tasks.add_task(_run_ingestion, model, init_time, req.force)

    return TriggerResponse(
        model=model,
        init_time=init_time.isoformat(),
        status="queued",
        message=(
            f"{model} ingestion for {init_time.isoformat()}"
            " queued. Poll GET /api/admin/status."
        ),
    )


# ---------------------------------------------------------------------------
# Clear operations
# ---------------------------------------------------------------------------


@router.delete("/runs", summary="Delete all model run records")
async def clear_runs():
    async with async_session() as db:
        await db.execute(delete(ModelPointValue))
        result = await db.execute(delete(ModelRun))
        await db.commit()
    return {"deleted_runs": result.rowcount}


@router.delete("/metrics", summary="Delete all point metric records")
async def clear_metrics():
    async with async_session() as db:
        result = await db.execute(delete(PointMetric))
        await db.commit()
    return {"deleted_metrics": result.rowcount}


@router.delete(
    "/snapshots",
    summary="Delete grid snapshot records and Zarr files on disk",
)
async def clear_snapshots():
    async with async_session() as db:
        result = await db.execute(delete(GridSnapshot))
        await db.commit()

    zarr_dir = settings.data_store_path / "divergence"
    if zarr_dir.exists():
        shutil.rmtree(zarr_dir)
        zarr_dir.mkdir(parents=True, exist_ok=True)

    return {"deleted_snapshots": result.rowcount, "zarr_dir_cleared": True}


@router.delete("/cache", summary="Delete cached herbie GRIB subset files")
async def clear_cache():
    deleted = 0
    for f in settings.data_store_path.rglob("subset_*.grib2"):
        f.unlink()
        deleted += 1
    return {"deleted_cache_files": deleted}


@router.delete(
    "/reset",
    summary="Full reset: clear all DB records, Zarr files, and GRIB cache",
)
async def reset_all():
    async with async_session() as db:
        model_values = (await db.execute(delete(ModelPointValue))).rowcount
        metrics = (await db.execute(delete(PointMetric))).rowcount
        snapshots = (await db.execute(delete(GridSnapshot))).rowcount
        runs = (await db.execute(delete(ModelRun))).rowcount
        await db.commit()

    zarr_dir = settings.data_store_path / "divergence"
    if zarr_dir.exists():
        shutil.rmtree(zarr_dir)
        zarr_dir.mkdir(parents=True, exist_ok=True)

    cache_deleted = 0
    for f in settings.data_store_path.rglob("subset_*.grib2"):
        f.unlink()
        cache_deleted += 1

    return {
        "deleted_runs": runs,
        "deleted_metrics": metrics,
        "deleted_snapshots": snapshots,
        "zarr_dir_cleared": True,
        "deleted_cache_files": cache_deleted,
    }
