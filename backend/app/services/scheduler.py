"""APScheduler jobs for periodic NWP data ingestion and divergence computation."""

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.config import settings

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()

# Limit to one concurrent ingestion so heavy CPU work doesn't starve the event loop
_ingestion_semaphore = asyncio.Semaphore(1)


def _latest_cycle(
    hour_interval: int = 6, availability_delay_hours: int = 5
) -> datetime:
    """Return the most recent model cycle whose data is likely available.

    NWP model output (GFS, NAM, HRRR) is published on NOMADS/cloud mirrors
    roughly 3.5–5 hours after the nominal cycle time.
    ``availability_delay_hours`` is subtracted from the current time before
    rounding down, so we select a cycle whose data should already exist.
    """
    now = datetime.now(timezone.utc)
    adjusted = now - timedelta(hours=availability_delay_hours)
    cycle_hour = (adjusted.hour // hour_interval) * hour_interval
    return adjusted.replace(hour=cycle_hour, minute=0, second=0, microsecond=0)


async def _clear_divergence_for_lead_hours(
    db, init_time: datetime, lead_hours: set[int]
):
    """Remove existing divergence data for specific lead hours before recomputing.

    Only deletes data for the given *lead_hours* so that divergence at other
    forecast hours (computed with a different model subset) is preserved.
    """
    from sqlalchemy import delete, or_, select

    from app.models import GridSnapshot, ModelPointValue, ModelRun, PointMetric

    run_ids_result = await db.execute(
        select(ModelRun.id).where(ModelRun.init_time == init_time)
    )
    run_ids = list(run_ids_result.scalars().all())

    hours_list = list(lead_hours)

    if run_ids:
        await db.execute(
            delete(PointMetric).where(
                or_(
                    PointMetric.run_a_id.in_(run_ids),
                    PointMetric.run_b_id.in_(run_ids),
                ),
                PointMetric.lead_hour.in_(hours_list),
            )
        )
        await db.execute(
            delete(ModelPointValue).where(
                ModelPointValue.run_id.in_(run_ids),
                ModelPointValue.lead_hour.in_(hours_list),
            )
        )

    await db.execute(
        delete(GridSnapshot).where(
            GridSnapshot.init_time == init_time,
            GridSnapshot.lead_hour.in_(hours_list),
        )
    )


async def ingest_and_process(
    model_name: str,
    init_time: datetime | None = None,
    other_model_data: dict[str, dict] | None = None,
) -> dict | None:
    """Fetch model data, compute divergence metrics, and store results.

    Parameters
    ----------
    other_model_data : dict, optional
        Pre-fetched datasets from other models keyed by model name.  When
        provided these are used for cross-model divergence instead of
        re-fetching from external sources.  Used during startup seeding
        so each model is only downloaded once.

    Returns
    -------
    dict or None
        The fetched data for this model (``{lead_hour: xr.Dataset}``),
        or ``None`` if the model was already ingested.
    """
    from sqlalchemy import select

    from app.database import async_session
    from app.models import (
        GridSnapshot,
        ModelPointValue,
        ModelRun,
        PointMetric,
        RunStatus,
    )
    from app.services.ingestion.ecmwf import ECMWFFetcher
    from app.services.ingestion.gfs import GFSFetcher
    from app.services.ingestion.hrrr import HRRRFetcher
    from app.services.ingestion.nam import NAMFetcher
    from app.services.processing.grid import (
        compute_grid_divergence,
        save_divergence_zarr,
    )
    from app.services.processing.metrics import (
        compute_ensemble_spread,
        compute_pairwise_metrics,
    )

    fetchers = {
        "GFS": GFSFetcher,
        "NAM": NAMFetcher,
        "ECMWF": ECMWFFetcher,
        "HRRR": HRRRFetcher,
    }
    init_time = init_time or _latest_cycle()
    logger.info("Starting ingestion for %s cycle %s", model_name, init_time)

    # Serialize ingestions so only one runs at a time, keeping the event loop free
    async with _ingestion_semaphore:
        async with async_session() as db:
            # Check if already processed
            existing = await db.execute(
                select(ModelRun).where(
                    ModelRun.model_name == model_name,
                    ModelRun.init_time == init_time,
                )
            )
            if existing.scalar_one_or_none():
                logger.info("%s %s already ingested, skipping", model_name, init_time)
                return None

            # Create pending run record
            run = ModelRun(
                model_name=model_name,
                init_time=init_time,
                forecast_hours=[],
                status=RunStatus.pending,
            )
            db.add(run)
            await db.commit()

            try:
                # Run CPU-heavy GRIB2 fetch in a thread to avoid blocking the event loop
                fetcher = fetchers[model_name]()
                data = await asyncio.to_thread(fetcher.fetch, init_time)
                run.forecast_hours = sorted(data.keys())

                # Gather other available models for cross-model divergence.
                all_model_data: dict[str, dict[int, object]] = {model_name: data}
                if other_model_data:
                    # Use pre-fetched data (avoids redundant downloads during seed).
                    all_model_data.update(other_model_data)
                else:
                    for other_name, other_cls in fetchers.items():
                        if other_name == model_name:
                            continue
                        other_run = await db.execute(
                            select(ModelRun).where(
                                ModelRun.model_name == other_name,
                                ModelRun.init_time == init_time,
                                ModelRun.status == RunStatus.complete,
                            )
                        )
                        if other_run.scalar_one_or_none():
                            try:
                                other_data = await asyncio.to_thread(
                                    other_cls().fetch, init_time
                                )
                                all_model_data[other_name] = other_data
                            except Exception:
                                logger.warning(
                                    "Could not fetch %s for comparison", other_name
                                )

                # Compute divergence at every lead hour that has 2+ models.
                # This uses a *union* of all models' lead hours (not the
                # intersection) so that, e.g., GFS-NAM divergence at fhr 54-72
                # is preserved even though HRRR only goes to 48h.
                variables = ["precip", "wind_speed", "mslp", "hgt_500"]
                if len(all_model_data) >= 2:
                    # Collect every lead hour that at least 2 models cover.
                    all_hours: set[int] = set()
                    for d in all_model_data.values():
                        all_hours |= set(d.keys())
                    divergence_hours = {
                        h
                        for h in all_hours
                        if sum(1 for d in all_model_data.values() if h in d)
                        >= 2
                    }

                    # Only clear data for the hours we are about to rewrite.
                    await _clear_divergence_for_lead_hours(
                        db, init_time, divergence_hours
                    )

                    # Pre-fetch ModelRun records once (avoids O(pairs *
                    # locations * variables * hours) redundant queries).
                    run_lookup: dict[str, ModelRun] = {}
                    for mname in all_model_data:
                        res = await db.execute(
                            select(ModelRun).where(
                                ModelRun.model_name == mname,
                                ModelRun.init_time == init_time,
                            )
                        )
                        mr = res.scalar_one_or_none()
                        if mr:
                            run_lookup[mname] = mr

                    for fhr in sorted(divergence_hours):
                        fhr_datasets = {
                            name: d[fhr]
                            for name, d in all_model_data.items()
                            if fhr in d
                        }

                        for var in variables:
                            # Point metrics at configured monitor points
                            for lat, lon, label in settings.monitor_points:
                                try:
                                    pairs = await asyncio.to_thread(
                                        compute_pairwise_metrics,
                                        fhr_datasets,
                                        var,
                                        lat,
                                        lon,
                                    )
                                    spread = await asyncio.to_thread(
                                        compute_ensemble_spread,
                                        fhr_datasets,
                                        var,
                                        lat,
                                        lon,
                                    )
                                    latest_rmse = 0.0
                                    latest_bias = 0.0
                                    seen_models: set[str] = set()
                                    for pair in pairs:
                                        ra = run_lookup.get(pair["model_a"])
                                        rb = run_lookup.get(pair["model_b"])
                                        if ra and rb:
                                            pm = PointMetric(
                                                run_a_id=ra.id,
                                                run_b_id=rb.id,
                                                variable=var,
                                                lat=lat,
                                                lon=lon,
                                                lead_hour=fhr,
                                                rmse=pair["rmse"],
                                                bias=pair["bias"],
                                                spread=spread,
                                            )
                                            db.add(pm)
                                            latest_rmse = max(
                                                latest_rmse, pair["rmse"]
                                            )
                                            latest_bias = pair["bias"]
                                        # Persist per-model raw values (once each)
                                        if ra and pair["model_a"] not in seen_models:
                                            seen_models.add(pair["model_a"])
                                            db.add(
                                                ModelPointValue(
                                                    run_id=ra.id,
                                                    variable=var,
                                                    lat=lat,
                                                    lon=lon,
                                                    lead_hour=fhr,
                                                    value=pair["val_a"],
                                                )
                                            )
                                        if rb and pair["model_b"] not in seen_models:
                                            seen_models.add(pair["model_b"])
                                            db.add(
                                                ModelPointValue(
                                                    run_id=rb.id,
                                                    variable=var,
                                                    lat=lat,
                                                    lon=lon,
                                                    lead_hour=fhr,
                                                    value=pair["val_b"],
                                                )
                                            )

                                    # Check alert rules
                                    if settings.alert_check_enabled:
                                        from app.services.alerts import check_alerts

                                        await check_alerts(
                                            db,
                                            var,
                                            lat,
                                            lon,
                                            fhr,
                                            spread,
                                            latest_rmse,
                                            latest_bias,
                                            location_label=label,
                                        )
                                except Exception:
                                    logger.warning(
                                        "Point metric failed: %s fhr=%d var=%s",
                                        model_name,
                                        fhr,
                                        var,
                                    )

                            # Grid divergence (CPU-heavy regridding in thread)
                            try:
                                div_grid = await asyncio.to_thread(
                                    compute_grid_divergence, fhr_datasets, var
                                )
                                init_str = init_time.strftime("%Y%m%d%H")
                                zarr_path = await asyncio.to_thread(
                                    save_divergence_zarr,
                                    div_grid,
                                    settings.data_store_path,
                                    init_str,
                                    var,
                                    fhr,
                                )
                                lats = div_grid.coords["latitude"].values
                                lons = div_grid.coords["longitude"].values
                                gs = GridSnapshot(
                                    init_time=init_time,
                                    variable=var,
                                    lead_hour=fhr,
                                    zarr_path=zarr_path,
                                    bbox={
                                        "min_lat": float(lats.min()),
                                        "max_lat": float(lats.max()),
                                        "min_lon": float(lons.min()),
                                        "max_lon": float(lons.max()),
                                    },
                                )
                                db.add(gs)
                            except Exception:
                                logger.warning(
                                    "Grid divergence failed: fhr=%d var=%s",
                                    fhr,
                                    var,
                                )

                run.status = RunStatus.complete
                await db.commit()
                logger.info("%s %s ingestion complete", model_name, init_time)

                return data

            except Exception:
                logger.exception("%s ingestion failed", model_name)
                run.status = RunStatus.error
                await db.commit()
                return None


# Register cron jobs: GFS/NAM/HRRR every 6 hours, ECMWF once daily.
# Data is typically published ~3.5-5h after cycle time on NOMADS, so
# we fire ~5h after each cycle (00Z→05:xx, 06Z→11:xx, 12Z→17:xx, 18Z→23:xx).
scheduler.add_job(
    ingest_and_process,
    "cron",
    hour="5,11,17,23",
    minute=30,
    args=["GFS"],
    id="ingest_gfs",
    replace_existing=True,
)

scheduler.add_job(
    ingest_and_process,
    "cron",
    hour="5,11,17,23",
    minute=45,
    args=["NAM"],
    id="ingest_nam",
    replace_existing=True,
)

scheduler.add_job(
    ingest_and_process,
    "cron",
    hour=14,  # ECMWF 00Z run available ~12-14h later
    minute=0,
    args=["ECMWF"],
    id="ingest_ecmwf",
    replace_existing=True,
)

scheduler.add_job(
    ingest_and_process,
    "cron",
    hour="5,11,17,23",
    minute=15,
    args=["HRRR"],
    id="ingest_hrrr",
    replace_existing=True,
)
