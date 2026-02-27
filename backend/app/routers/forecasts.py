import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import ModelRun, PointMetric
from app.schemas.divergence import PointMetricOut
from app.schemas.forecast import ModelRunOut
from app.services.ingestion.base import VARIABLES

router = APIRouter(tags=["forecasts"])


@router.get("/variables")
async def list_variables():
    return VARIABLES


@router.get("/monitor-points", summary="Configured monitoring locations")
async def list_monitor_points():
    """Return the pre-configured geographic monitoring points."""
    return [
        {"lat": lat, "lon": lon, "label": label}
        for lat, lon, label in settings.monitor_points
    ]


@router.get("/runs", response_model=list[ModelRunOut])
async def list_runs(
    model_name: str | None = Query(None),
    since: datetime | None = Query(None),
    limit: int = Query(20, le=100),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(ModelRun).order_by(ModelRun.init_time.desc()).limit(limit)
    if model_name:
        stmt = stmt.where(ModelRun.model_name == model_name.upper())
    if since:
        stmt = stmt.where(ModelRun.init_time >= since)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/runs/{run_id}/metrics", response_model=list[PointMetricOut])
async def get_run_metrics(run_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Return all point metrics associated with a specific model run."""
    run = await db.get(ModelRun, run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    stmt = (
        select(PointMetric)
        .where(or_(PointMetric.run_a_id == run_id, PointMetric.run_b_id == run_id))
        .order_by(PointMetric.variable, PointMetric.lead_hour)
    )
    result = await db.execute(stmt)
    return result.scalars().all()
