from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import GridSnapshot, PointMetric
from app.schemas.divergence import (
    DivergenceSummary,
    GridDivergenceData,
    GridSnapshotOut,
    PointMetricOut,
)
from app.services.processing.grid import load_divergence_zarr

router = APIRouter(prefix="/divergence", tags=["divergence"])


@router.get("/point", response_model=list[PointMetricOut])
async def get_point_divergence(
    lat: float = Query(...),
    lon: float = Query(...),
    variable: str = Query(...),
    lead_hour: int | None = Query(None),
    limit: int = Query(50, le=200),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(PointMetric)
        .where(PointMetric.variable == variable)
        .order_by(PointMetric.created_at.desc())
        .limit(limit)
    )
    # Filter by approximate location (within ~0.5 degrees)
    stmt = stmt.where(
        PointMetric.lat.between(lat - 0.5, lat + 0.5),
        PointMetric.lon.between(lon - 0.5, lon + 0.5),
    )
    if lead_hour is not None:
        stmt = stmt.where(PointMetric.lead_hour == lead_hour)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/grid", response_model=GridDivergenceData)
async def get_grid_divergence(
    variable: str = Query(...),
    lead_hour: int = Query(0),
    init_time: datetime | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(GridSnapshot)
        .where(
            GridSnapshot.variable == variable,
            GridSnapshot.lead_hour == lead_hour,
        )
        .order_by(GridSnapshot.init_time.desc())
        .limit(1)
    )
    if init_time:
        stmt = stmt.where(GridSnapshot.init_time == init_time)

    result = await db.execute(stmt)
    snapshot = result.scalar_one_or_none()
    if not snapshot:
        raise HTTPException(404, "No grid divergence data found")

    da = load_divergence_zarr(snapshot.zarr_path)
    return GridDivergenceData(
        variable=snapshot.variable,
        lead_hour=snapshot.lead_hour,
        init_time=snapshot.init_time.isoformat(),
        latitudes=da.coords["latitude"].values.tolist(),
        longitudes=da.coords["longitude"].values.tolist(),
        values=da.values.tolist(),
        bbox=snapshot.bbox,
    )


@router.get("/grid/snapshots", response_model=list[GridSnapshotOut])
async def list_grid_snapshots(
    variable: str | None = Query(None),
    limit: int = Query(20, le=100),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(GridSnapshot).order_by(GridSnapshot.init_time.desc()).limit(limit)
    )
    if variable:
        stmt = stmt.where(GridSnapshot.variable == variable)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/summary", response_model=list[DivergenceSummary])
async def get_divergence_summary(
    db: AsyncSession = Depends(get_db),
):
    """Return latest divergence summary per variable for the dashboard."""
    from sqlalchemy import func

    variables = ["precip", "wind_speed", "mslp", "hgt_500"]
    summaries = []

    for var in variables:
        stmt = (
            select(
                func.avg(PointMetric.spread).label("mean_spread"),
                func.max(PointMetric.spread).label("max_spread"),
                func.count(PointMetric.id).label("num_points"),
            )
            .where(PointMetric.variable == var)
        )
        result = await db.execute(stmt)
        row = result.one_or_none()

        if row and row.num_points > 0:
            summaries.append(
                DivergenceSummary(
                    variable=var,
                    mean_spread=round(float(row.mean_spread or 0), 4),
                    max_spread=round(float(row.max_spread or 0), 4),
                    num_points=int(row.num_points),
                    models_compared=["GFS", "NAM", "ECMWF"],
                    init_time="latest",
                )
            )

    return summaries
