from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import ModelRun
from app.schemas.forecast import ModelRunOut
from app.services.ingestion.base import VARIABLES

router = APIRouter(tags=["forecasts"])


@router.get("/variables")
async def list_variables():
    return VARIABLES


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
