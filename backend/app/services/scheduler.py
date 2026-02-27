"""APScheduler jobs for periodic NWP data ingestion and divergence computation."""

import asyncio
import logging
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.config import settings

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()

# Limit to one concurrent ingestion so heavy CPU work doesn't starve the event loop
_ingestion_semaphore = asyncio.Semaphore(1)


def _latest_cycle(hour_interval: int = 6) -> datetime:
    """Return the most recent model cycle init time (rounded down to interval)."""
    now = datetime.now(timezone.utc)
    cycle_hour = (now.hour // hour_interval) * hour_interval
    return now.replace(hour=cycle_hour, minute=0, second=0, microsecond=0)


async def ingest_and_process(model_name: str, init_time: datetime | None = None):
    """Fetch model data, compute divergence metrics, and store results."""
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
                return

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

                # Fetch other available models for cross-model divergence
                all_model_data: dict[str, dict[int, object]] = {model_name: data}
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

                # Compute divergence for common lead hours
                variables = ["precip", "wind_speed", "mslp", "hgt_500"]
                if len(all_model_data) >= 2:
                    common_hours = set(data.keys())
                    for other_data in all_model_data.values():
                        common_hours &= set(other_data.keys())

                    for fhr in sorted(common_hours):
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
                                    # Collect raw per-model values for the Outlook page
                                    model_runs: dict[str, object] = {}
                                    model_values: dict[str, float] = {}
                                    for pair in pairs:
                                        # Look up run IDs
                                        run_a = await db.execute(
                                            select(ModelRun).where(
                                                ModelRun.model_name == pair["model_a"],
                                                ModelRun.init_time == init_time,
                                            )
                                        )
                                        run_b = await db.execute(
                                            select(ModelRun).where(
                                                ModelRun.model_name == pair["model_b"],
                                                ModelRun.init_time == init_time,
                                            )
                                        )
                                        ra = run_a.scalar_one_or_none()
                                        rb = run_b.scalar_one_or_none()
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
                                            latest_rmse = max(latest_rmse, pair["rmse"])
                                            latest_bias = pair["bias"]
                                        # Accumulate per-model raw values
                                        if ra and pair["model_a"] not in model_runs:
                                            model_runs[pair["model_a"]] = ra
                                            model_values[pair["model_a"]] = pair[
                                                "val_a"
                                            ]
                                        if rb and pair["model_b"] not in model_runs:
                                            model_runs[pair["model_b"]] = rb
                                            model_values[pair["model_b"]] = pair[
                                                "val_b"
                                            ]
                                    # Persist raw per-model values (only for
                                    # the model being ingested — other models
                                    # already saved theirs during their own pass)
                                    if model_name in model_runs:
                                        db.add(
                                            ModelPointValue(
                                                run_id=model_runs[model_name].id,
                                                variable=var,
                                                lat=lat,
                                                lon=lon,
                                                lead_hour=fhr,
                                                value=model_values[model_name],
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
                                    "Grid divergence failed: fhr=%d var=%s", fhr, var
                                )

                run.status = RunStatus.complete
                await db.commit()
                logger.info("%s %s ingestion complete", model_name, init_time)

            except Exception:
                logger.exception("%s ingestion failed", model_name)
                run.status = RunStatus.error
                await db.commit()


# Register cron jobs: GFS and NAM every 6 hours, ECMWF once daily
scheduler.add_job(
    ingest_and_process,
    "cron",
    hour="1,7,13,19",  # ~1h after model init to allow for data availability
    minute=30,
    args=["GFS"],
    id="ingest_gfs",
    replace_existing=True,
)

scheduler.add_job(
    ingest_and_process,
    "cron",
    hour="1,7,13,19",
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
    hour="1,7,13,19",
    minute=15,  # HRRR: slightly before GFS/NAM
    args=["HRRR"],
    id="ingest_hrrr",
    replace_existing=True,
)
