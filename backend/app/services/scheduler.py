"""APScheduler jobs for periodic NWP data ingestion and divergence computation.

Memory-optimised architecture (fits in 2 GB):
* ``ingest_and_process`` fetches ONE model, stores its ModelRun +
  ModelPointValues, then frees the data.  No cross-model work happens here.
* ``recompute_cycle_divergence`` runs separately and fetches each model
  ONE lead-hour at a time, computes pairwise metrics + grid divergence,
  then frees the data before moving to the next lead hour.  Peak memory
  is ~100 MB regardless of how many models or lead hours exist.
"""

import asyncio
import gc
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path

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


def _compute_divergence_hours(
    all_model_data: dict[str, dict[int, object]],
) -> set[int]:
    """Return lead hours covered by at least two models.

    Uses the *union* of every model's lead hours, then filters to those
    where at least two models have data.  This ensures that, e.g.,
    GFS-NAM divergence at fhr 54-72 is kept even though HRRR only
    goes to 48 h.
    """
    all_hours: set[int] = set()
    for d in all_model_data.values():
        all_hours |= set(d.keys())
    return {
        h for h in all_hours if sum(1 for d in all_model_data.values() if h in d) >= 2
    }


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


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _clean_herbie_cache():
    """Remove cached GRIB2 subset files to free disk space."""
    herbie_dir = Path.home() / ".herbie"
    if not herbie_dir.exists():
        return
    deleted = 0
    for f in herbie_dir.rglob("subset_*"):
        try:
            f.unlink()
            deleted += 1
        except OSError:
            pass
    if deleted:
        logger.info("Cleaned %d cached herbie files", deleted)


def _get_fetchers():
    """Lazy-import fetcher classes to avoid circular imports."""
    from app.services.ingestion.aigfs import AIGFSFetcher
    from app.services.ingestion.ecmwf import ECMWFFetcher
    from app.services.ingestion.gfs import GFSFetcher
    from app.services.ingestion.hrrr import HRRRFetcher
    from app.services.ingestion.nam import NAMFetcher
    from app.services.ingestion.rrfs import RRFSFetcher

    return {
        "GFS": GFSFetcher,
        "NAM": NAMFetcher,
        "ECMWF": ECMWFFetcher,
        "HRRR": HRRRFetcher,
        "AIGFS": AIGFSFetcher,
        "RRFS": RRFSFetcher,
    }


# ---------------------------------------------------------------------------
# Ingestion (single model – no cross-model work)
# ---------------------------------------------------------------------------


async def ingest_and_process(
    model_name: str,
    init_time: datetime | None = None,
    force: bool = False,
) -> dict | None:
    """Fetch one model's data, store ModelRun + ModelPointValues.

    Cross-model divergence is NOT computed here — call
    ``recompute_cycle_divergence`` after all models are ingested.

    Returns
    -------
    dict or None
        ``{lead_hour: xr.Dataset}`` on success, ``None`` if skipped or failed.
    """
    from sqlalchemy import select

    from app.database import async_session
    from app.models import (
        ModelPointValue,
        ModelRun,
        PointMetric,
        RunStatus,
    )
    from app.services.processing.metrics import extract_point

    fetchers = _get_fetchers()
    if init_time is None:
        if model_name == "AIGFS":
            init_time = _latest_cycle(hour_interval=12)
        elif model_name == "ECMWF":
            # IFS open data takes 7-9h to publish (longer than NOMADS models)
            init_time = _latest_cycle(availability_delay_hours=9)
        else:
            init_time = _latest_cycle()
    logger.info("Starting ingestion for %s cycle %s", model_name, init_time)

    async with _ingestion_semaphore:
        async with async_session() as db:
            # Check if already processed
            existing_run = (
                await db.execute(
                    select(ModelRun).where(
                        ModelRun.model_name == model_name,
                        ModelRun.init_time == init_time,
                    )
                )
            ).scalar_one_or_none()

            if existing_run:
                if not force:
                    logger.info(
                        "%s %s already ingested, skipping", model_name, init_time
                    )
                    return None

                # Force mode: remove the existing run and associated data.
                logger.info(
                    "%s %s exists — force-removing for re-ingestion",
                    model_name,
                    init_time,
                )
                from sqlalchemy import delete as sa_delete
                from sqlalchemy import or_

                await db.execute(
                    sa_delete(PointMetric).where(
                        or_(
                            PointMetric.run_a_id == existing_run.id,
                            PointMetric.run_b_id == existing_run.id,
                        )
                    )
                )
                await db.execute(
                    sa_delete(ModelPointValue).where(
                        ModelPointValue.run_id == existing_run.id,
                    )
                )
                await db.delete(existing_run)
                await db.commit()

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
                # Run CPU-heavy GRIB2 fetch in a thread
                fetcher = fetchers[model_name]()
                data = await asyncio.to_thread(fetcher.fetch, init_time)
                run.forecast_hours = sorted(data.keys())

                # Store raw per-model point values at each monitor location.
                variables = ["precip", "wind_speed", "mslp", "hgt_500"]
                for fhr in sorted(data.keys()):
                    ds = data[fhr]
                    for var in variables:
                        if var not in ds:
                            continue
                        for lat, lon, _label in settings.monitor_points:
                            try:
                                value = extract_point(ds, var, lat, lon)
                                db.add(
                                    ModelPointValue(
                                        run_id=run.id,
                                        variable=var,
                                        lat=lat,
                                        lon=lon,
                                        lead_hour=fhr,
                                        value=value,
                                    )
                                )
                            except Exception:
                                pass
                    # Flush per lead hour to limit session identity-map growth
                    await db.flush()

                run.status = RunStatus.complete
                await db.commit()
                logger.info("%s %s ingestion complete", model_name, init_time)

                _clean_herbie_cache()
                gc.collect()

                return data

            except Exception:
                logger.exception("%s ingestion failed", model_name)
                run.status = RunStatus.error
                await db.commit()
                return None


# ---------------------------------------------------------------------------
# Cross-model divergence (memory-efficient, per-lead-hour)
# ---------------------------------------------------------------------------


async def recompute_cycle_divergence(init_time: datetime | None = None):
    """Recompute cross-model divergence for a cycle.

    Fetches each model ONE lead hour at a time so peak memory stays ~100 MB
    regardless of how many models or hours exist.  Replaces existing
    PointMetric and GridSnapshot rows for the processed hours.
    """
    from sqlalchemy import delete as sa_delete
    from sqlalchemy import func, or_, select

    from app.database import async_session
    from app.models import (
        GridSnapshot,
        ModelRun,
        PointMetric,
        RunStatus,
    )
    from app.services.processing.grid import (
        compute_grid_divergence,
        save_divergence_zarr,
    )
    from app.services.processing.metrics import (
        compute_ensemble_spread,
        compute_pairwise_metrics,
    )

    fetchers = _get_fetchers()

    # ------------------------------------------------------------------
    # 1. Discover which init_time to process
    # ------------------------------------------------------------------
    async with async_session() as db:
        if init_time is None:
            result = await db.execute(
                select(ModelRun.init_time)
                .where(ModelRun.status == RunStatus.complete)
                .group_by(ModelRun.init_time)
                .having(func.count() >= 2)
                .order_by(ModelRun.init_time.desc())
                .limit(1)
            )
            init_time = result.scalar_one_or_none()

        if init_time is None:
            logger.info("No init_time with 2+ completed models — skipping divergence")
            return

        completed_runs = (
            (
                await db.execute(
                    select(ModelRun).where(
                        ModelRun.init_time == init_time,
                        ModelRun.status == RunStatus.complete,
                    )
                )
            )
            .scalars()
            .all()
        )

    if len(completed_runs) < 2:
        return

    model_hours: dict[str, set[int]] = {
        r.model_name: set(r.forecast_hours) for r in completed_runs
    }
    run_id_lookup: dict[str, int] = {r.model_name: r.id for r in completed_runs}

    # Which lead hours have 2+ models?
    all_hours: set[int] = set()
    for hours in model_hours.values():
        all_hours |= hours
    divergence_hours = {
        h
        for h in all_hours
        if sum(1 for hours in model_hours.values() if h in hours) >= 2
    }
    if not divergence_hours:
        return

    logger.info(
        "Computing divergence for %s: %d models, %d lead hours",
        init_time,
        len(completed_runs),
        len(divergence_hours),
    )

    # ------------------------------------------------------------------
    # 2. Clear existing PointMetrics + GridSnapshots (NOT ModelPointValues)
    # ------------------------------------------------------------------
    async with async_session() as db:
        run_ids = list(run_id_lookup.values())
        hours_list = list(divergence_hours)

        if run_ids:
            await db.execute(
                sa_delete(PointMetric).where(
                    or_(
                        PointMetric.run_a_id.in_(run_ids),
                        PointMetric.run_b_id.in_(run_ids),
                    ),
                    PointMetric.lead_hour.in_(hours_list),
                )
            )
        await db.execute(
            sa_delete(GridSnapshot).where(
                GridSnapshot.init_time == init_time,
                GridSnapshot.lead_hour.in_(hours_list),
            )
        )
        await db.commit()

    # ------------------------------------------------------------------
    # 3. Process one lead hour at a time
    # ------------------------------------------------------------------
    variables = ["precip", "wind_speed", "mslp", "hgt_500"]

    async with _ingestion_semaphore:
        async with async_session() as db:
            for fhr in sorted(divergence_hours):
                # Fetch each model's data for just this lead hour
                fhr_datasets: dict[str, object] = {}
                for model_name, hours in model_hours.items():
                    if fhr not in hours:
                        continue
                    try:
                        fetcher = fetchers[model_name]()
                        fhr_data = await asyncio.to_thread(
                            fetcher.fetch, init_time, lead_hours=[fhr]
                        )
                        if fhr in fhr_data:
                            fhr_datasets[model_name] = fhr_data[fhr]
                        del fhr_data
                    except Exception:
                        logger.warning(
                            "Divergence fetch failed: %s fhr=%d", model_name, fhr
                        )
                    gc.collect()

                if len(fhr_datasets) < 2:
                    del fhr_datasets
                    gc.collect()
                    continue

                for var in variables:
                    # --- Point metrics ---
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
                            for pair in pairs:
                                ra_id = run_id_lookup.get(pair["model_a"])
                                rb_id = run_id_lookup.get(pair["model_b"])
                                if ra_id and rb_id:
                                    db.add(
                                        PointMetric(
                                            run_a_id=ra_id,
                                            run_b_id=rb_id,
                                            variable=var,
                                            lat=lat,
                                            lon=lon,
                                            lead_hour=fhr,
                                            rmse=pair["rmse"],
                                            bias=pair["bias"],
                                            spread=spread,
                                        )
                                    )
                                    latest_rmse = max(latest_rmse, pair["rmse"])
                                    latest_bias = pair["bias"]

                            if settings.alert_check_enabled and pairs:
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
                                "Point metric failed: fhr=%d var=%s",
                                fhr,
                                var,
                            )

                    # --- Grid divergence ---
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
                        db.add(
                            GridSnapshot(
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
                        )
                        del div_grid
                    except Exception:
                        logger.warning(
                            "Grid divergence failed: fhr=%d var=%s",
                            fhr,
                            var,
                        )

                # Commit + free per-lead-hour
                await db.commit()
                del fhr_datasets
                gc.collect()

    _clean_herbie_cache()
    logger.info("Divergence computation complete for %s", init_time)


# ---------------------------------------------------------------------------
# Cron jobs
# ---------------------------------------------------------------------------

# Model ingestion: all models every 6 hours.
# Data is typically published ~3.5-5h after cycle time on NOMADS.
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
    hour="9,15,21,3",
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

# AIGFS: 2x daily (00Z and 12Z cycles only, ~5h delay)
scheduler.add_job(
    ingest_and_process,
    "cron",
    hour="5,17",
    minute=35,
    args=["AIGFS"],
    id="ingest_aigfs",
    replace_existing=True,
)

# RRFS: 4x daily (prototype, 3km convection-allowing)
scheduler.add_job(
    ingest_and_process,
    "cron",
    hour="5,11,17,23",
    minute=20,
    args=["RRFS"],
    id="ingest_rrfs",
    replace_existing=True,
)

# Cross-model divergence: runs after all models for a cycle are expected
# to be ingested (~3h after first model cron fires).
scheduler.add_job(
    recompute_cycle_divergence,
    "cron",
    hour="8,14,20,2",
    minute=0,
    id="divergence",
    replace_existing=True,
)
