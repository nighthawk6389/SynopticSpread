from collections import defaultdict

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import ModelPointValue, ModelRun
from app.schemas.verification import VerificationResponse, VerificationScore

router = APIRouter(prefix="/verification", tags=["verification"])


@router.get("/scores", response_model=VerificationResponse)
async def get_verification_scores(
    lat: float = Query(...),
    lon: float = Query(...),
    variable: str = Query(...),
    model_name: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Compare forecasts against analysis fields (lead_hour=0) from the same model.

    For each forecast (lead_hour > 0), compute valid_time = init_time + lead_hour.
    Find the analysis value (lead_hour=0) from the same model at the same valid_time
    (i.e. a later run whose init_time == the forecast's valid_time).
    Compute error, group by (model_name, lead_hour), return MAE + bias + n_samples.
    """
    # Fetch all model point values at this location for the requested variable
    stmt = (
        select(
            ModelPointValue.value,
            ModelPointValue.lead_hour,
            ModelRun.model_name,
            ModelRun.init_time,
        )
        .join(ModelRun, ModelPointValue.run_id == ModelRun.id)
        .where(
            ModelPointValue.variable == variable,
            ModelPointValue.lat.between(lat - 0.5, lat + 0.5),
            ModelPointValue.lon.between(lon - 0.5, lon + 0.5),
        )
    )
    if model_name:
        stmt = stmt.where(ModelRun.model_name == model_name.upper())

    result = await db.execute(stmt)
    rows = result.all()

    if not rows:
        return VerificationResponse(variable=variable, lat=lat, lon=lon, scores=[])

    # Separate analyses (lead_hour=0) from forecasts (lead_hour>0)
    # Key analyses by (model_name, init_time) since init_time IS the valid_time
    # for analyses.
    from datetime import timedelta

    analyses: dict[tuple[str, str], float] = {}
    # (model_name, lead_hour, init_time, value)
    forecasts: list[tuple[str, int, str, float]] = []

    for row in rows:
        if row.lead_hour == 0:
            # Analysis: valid_time = init_time
            key = (row.model_name, row.init_time.isoformat())
            analyses[key] = row.value
        else:
            forecasts.append((row.model_name, row.lead_hour, row.init_time, row.value))

    # For each forecast, find matching analysis
    # valid_time of forecast = init_time + timedelta(hours=lead_hour)
    # We need an analysis from the same model where init_time == valid_time
    errors: dict[tuple[str, int], list[float]] = defaultdict(list)

    for model, lead_hour, init_time, fcst_value in forecasts:
        valid_time = init_time + timedelta(hours=lead_hour)
        analysis_key = (model, valid_time.isoformat())
        if analysis_key in analyses:
            error = fcst_value - analyses[analysis_key]
            errors[(model, lead_hour)].append(error)

    # Compute MAE and bias per (model, lead_hour)
    scores = []
    for (model, lead_hour), errs in sorted(errors.items()):
        n = len(errs)
        mae = sum(abs(e) for e in errs) / n
        bias = sum(errs) / n
        scores.append(
            VerificationScore(
                model_name=model,
                lead_hour=lead_hour,
                mae=round(mae, 4),
                bias=round(bias, 4),
                n_samples=n,
            )
        )

    return VerificationResponse(
        variable=variable,
        lat=lat,
        lon=lon,
        scores=scores,
    )
