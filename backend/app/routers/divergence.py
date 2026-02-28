from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import GridSnapshot, ModelPointValue, ModelRun, PointMetric
from app.schemas.divergence import (
    DivergenceSummary,
    GridDivergenceData,
    GridSnapshotOut,
    ModelPointValueOut,
    PointMetricOut,
    SpreadHistoryOut,
    SpreadHistoryPoint,
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


@router.get("/history", response_model=SpreadHistoryOut)
async def get_spread_history(
    variable: str = Query(...),
    hours_back: int = Query(48, le=168),
    lat: float | None = Query(None),
    lon: float | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Return time-bucketed mean spread for sparkline display."""
    from collections import defaultdict

    cutoff = datetime.now(tz=timezone.utc) - timedelta(hours=hours_back)

    stmt = (
        select(PointMetric.created_at, PointMetric.spread)
        .where(
            PointMetric.variable == variable,
            PointMetric.created_at >= cutoff,
        )
        .order_by(PointMetric.created_at.asc())
    )
    if lat is not None and lon is not None:
        stmt = stmt.where(
            PointMetric.lat.between(lat - 0.5, lat + 0.5),
            PointMetric.lon.between(lon - 0.5, lon + 0.5),
        )

    result = await db.execute(stmt)
    rows = result.all()

    # Bucket by hour in Python (dialect-neutral)
    buckets: dict[str, list[float]] = defaultdict(list)
    for row in rows:
        hour_key = row.created_at.strftime("%Y-%m-%dT%H:00:00")
        buckets[hour_key].append(float(row.spread))

    points = [
        SpreadHistoryPoint(
            timestamp=ts,
            mean_spread=round(sum(vals) / len(vals), 4),
        )
        for ts, vals in sorted(buckets.items())
    ]

    return SpreadHistoryOut(variable=variable, points=points)


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
    stmt = select(GridSnapshot).order_by(GridSnapshot.init_time.desc()).limit(limit)
    if variable:
        stmt = stmt.where(GridSnapshot.variable == variable)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/summary", response_model=list[DivergenceSummary])
async def get_divergence_summary(
    lat: float | None = Query(None),
    lon: float | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Return latest divergence summary per variable for the dashboard.

    Filters to lead hours 0–48 and optionally by location (lat/lon).
    """
    from statistics import median

    variables = ["precip", "wind_speed", "mslp", "hgt_500"]
    summaries = []

    for var in variables:
        stmt = select(PointMetric.spread).where(
            PointMetric.variable == var,
            PointMetric.lead_hour <= 48,
        )
        if lat is not None and lon is not None:
            stmt = stmt.where(
                PointMetric.lat.between(lat - 0.5, lat + 0.5),
                PointMetric.lon.between(lon - 0.5, lon + 0.5),
            )
        result = await db.execute(stmt)
        spreads = [float(row.spread) for row in result.all()]

        if spreads:
            summaries.append(
                DivergenceSummary(
                    variable=var,
                    mean_spread=round(sum(spreads) / len(spreads), 4),
                    median_spread=round(median(spreads), 4),
                    max_spread=round(max(spreads), 4),
                    min_spread=round(min(spreads), 4),
                    num_points=len(spreads),
                    models_compared=["GFS", "NAM", "ECMWF", "HRRR"],
                    init_time="latest",
                )
            )

    return summaries


@router.get("/regional")
async def get_regional_divergence(
    variable: str = Query(...),
    lead_hour: int = Query(0),
    db: AsyncSession = Depends(get_db),
):
    """Return latest spread/rmse/bias at each monitor point
    for regional map coloring."""
    from app.config import settings

    results = []
    for lat, lon, label in settings.monitor_points:
        stmt = (
            select(PointMetric)
            .where(
                PointMetric.variable == variable,
                PointMetric.lat.between(lat - 0.5, lat + 0.5),
                PointMetric.lon.between(lon - 0.5, lon + 0.5),
                PointMetric.lead_hour == lead_hour,
            )
            .order_by(PointMetric.created_at.desc())
            .limit(1)
        )
        result = await db.execute(stmt)
        metric = result.scalar_one_or_none()
        results.append(
            {
                "lat": lat,
                "lon": lon,
                "label": label,
                "spread": metric.spread if metric else None,
                "rmse": metric.rmse if metric else None,
                "bias": metric.bias if metric else None,
            }
        )
    return results


@router.get("/model-values", response_model=list[ModelPointValueOut])
async def get_model_values(
    lat: float = Query(...),
    lon: float = Query(...),
    lead_hour: int = Query(...),
    variable: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Return the latest raw predicted value from each model at a monitor point.

    Joins model_point_values → model_runs to include model_name and init_time.
    Filters to the most recent init_time available for each model.
    """
    from sqlalchemy import func

    # Subquery: latest init_time per model at this location
    latest_subq = (
        select(
            ModelRun.model_name,
            func.max(ModelRun.init_time).label("latest_init"),
        )
        .join(ModelPointValue, ModelPointValue.run_id == ModelRun.id)
        .where(
            ModelPointValue.lat.between(lat - 0.5, lat + 0.5),
            ModelPointValue.lon.between(lon - 0.5, lon + 0.5),
            ModelPointValue.lead_hour == lead_hour,
        )
        .group_by(ModelRun.model_name)
        .subquery()
    )

    stmt = (
        select(
            ModelPointValue.run_id,
            ModelRun.model_name,
            ModelPointValue.variable,
            ModelPointValue.lat,
            ModelPointValue.lon,
            ModelPointValue.lead_hour,
            ModelPointValue.value,
            ModelRun.init_time,
        )
        .join(ModelRun, ModelPointValue.run_id == ModelRun.id)
        .join(
            latest_subq,
            (ModelRun.model_name == latest_subq.c.model_name)
            & (ModelRun.init_time == latest_subq.c.latest_init),
        )
        .where(
            ModelPointValue.lat.between(lat - 0.5, lat + 0.5),
            ModelPointValue.lon.between(lon - 0.5, lon + 0.5),
            ModelPointValue.lead_hour == lead_hour,
        )
    )
    if variable:
        stmt = stmt.where(ModelPointValue.variable == variable)

    result = await db.execute(stmt)
    rows = result.all()

    return [
        ModelPointValueOut(
            run_id=row.run_id,
            model_name=row.model_name,
            variable=row.variable,
            lat=row.lat,
            lon=row.lon,
            lead_hour=row.lead_hour,
            value=row.value,
            init_time=row.init_time,
        )
        for row in rows
    ]


@router.get("/decomposition")
async def get_decomposition(
    variable: str = Query(...),
    lat: float = Query(...),
    lon: float = Query(...),
    limit: int = Query(100, le=500),
    db: AsyncSession = Depends(get_db),
):
    """Return per-model-pair RMSE/bias grouped by lead hour
    for ensemble decomposition."""
    from collections import defaultdict

    # Fetch point metrics with their associated model run names
    stmt = (
        select(
            PointMetric.lead_hour,
            PointMetric.rmse,
            PointMetric.bias,
            PointMetric.spread,
            ModelRun.model_name.label("model_a_name"),
        )
        .join(ModelRun, PointMetric.run_a_id == ModelRun.id)
        .where(
            PointMetric.variable == variable,
            PointMetric.lat.between(lat - 0.5, lat + 0.5),
            PointMetric.lon.between(lon - 0.5, lon + 0.5),
        )
        .order_by(PointMetric.created_at.desc())
        .limit(limit)
    )
    await db.execute(stmt)

    # Also get model_b names
    stmt_b = (
        select(
            PointMetric.id,
            ModelRun.model_name.label("model_b_name"),
        )
        .join(ModelRun, PointMetric.run_b_id == ModelRun.id)
        .where(
            PointMetric.variable == variable,
            PointMetric.lat.between(lat - 0.5, lat + 0.5),
            PointMetric.lon.between(lon - 0.5, lon + 0.5),
        )
        .order_by(PointMetric.created_at.desc())
        .limit(limit)
    )
    result_b = await db.execute(stmt_b)
    b_names = {row.id: row.model_b_name for row in result_b.all()}

    # Also get the IDs from a separate query
    stmt_ids = (
        select(
            PointMetric.id,
            PointMetric.lead_hour,
            PointMetric.rmse,
            PointMetric.bias,
            PointMetric.spread,
        )
        .where(
            PointMetric.variable == variable,
            PointMetric.lat.between(lat - 0.5, lat + 0.5),
            PointMetric.lon.between(lon - 0.5, lon + 0.5),
        )
        .order_by(PointMetric.created_at.desc())
        .limit(limit)
    )
    result_ids = await db.execute(stmt_ids)
    id_rows = result_ids.all()

    # Build model_a name lookup
    stmt_a = (
        select(PointMetric.id, ModelRun.model_name.label("model_a_name"))
        .join(ModelRun, PointMetric.run_a_id == ModelRun.id)
        .where(
            PointMetric.variable == variable,
            PointMetric.lat.between(lat - 0.5, lat + 0.5),
            PointMetric.lon.between(lon - 0.5, lon + 0.5),
        )
        .order_by(PointMetric.created_at.desc())
        .limit(limit)
    )
    result_a = await db.execute(stmt_a)
    a_names = {row.id: row.model_a_name for row in result_a.all()}

    # Group by lead_hour and model pair
    by_hour: dict[int, dict] = defaultdict(lambda: {"pairs": {}, "total_spread": 0.0})
    seen_hours: dict[int, set] = defaultdict(set)

    for row in id_rows:
        fhr = row.lead_hour
        model_a = a_names.get(row.id, "?")
        model_b = b_names.get(row.id, "?")
        pair_key = (
            f"{model_a}-{model_b}" if model_a < model_b else f"{model_b}-{model_a}"
        )

        if pair_key in seen_hours[fhr]:
            continue
        seen_hours[fhr].add(pair_key)

        by_hour[fhr]["total_spread"] = row.spread
        a_name, b_name = pair_key.split("-", 1)
        by_hour[fhr]["pairs"][pair_key] = {
            "model_a": a_name,
            "model_b": b_name,
            "rmse": round(float(row.rmse), 4),
            "bias": round(float(row.bias), 4),
        }

    return [
        {
            "lead_hour": fhr,
            "total_spread": round(float(data["total_spread"]), 4),
            "pairs": list(data["pairs"].values()),
        }
        for fhr, data in sorted(by_hour.items())
    ]
