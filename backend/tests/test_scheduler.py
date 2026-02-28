"""Unit tests for the scheduler module.

apscheduler and herbie are not installed in the test environment so they are
stubbed at the sys.modules level before importing the scheduler module.
Database and fetcher interactions are fully mocked.
"""

import sys
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Stub out missing optional packages before any app imports that need them.
for _pkg in ("apscheduler", "apscheduler.schedulers", "apscheduler.schedulers.asyncio"):
    if _pkg not in sys.modules:
        sys.modules[_pkg] = MagicMock()

if "herbie" not in sys.modules:
    sys.modules["herbie"] = MagicMock()


# ---------------------------------------------------------------------------
# _latest_cycle – pure function
# ---------------------------------------------------------------------------


def test_latest_cycle_returns_six_hour_boundary():
    """The cycle time always falls on a 6-hour boundary with zeroed minutes/seconds."""
    from app.services.scheduler import _latest_cycle

    cycle = _latest_cycle()

    assert cycle.minute == 0
    assert cycle.second == 0
    assert cycle.microsecond == 0
    assert cycle.hour % 6 == 0
    assert cycle.tzinfo is not None


def test_latest_cycle_rounds_down():
    """_latest_cycle rounds the current hour DOWN, never up."""
    from app.services.scheduler import _latest_cycle

    # The result should always be <= the current UTC hour truncated to the
    # nearest multiple of 6, so it is always in the past.
    cycle = _latest_cycle()
    now = datetime.now(timezone.utc)
    assert cycle <= now.replace(minute=0, second=0, microsecond=0)


# ---------------------------------------------------------------------------
# ingest_and_process – idempotency
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ingest_skips_already_processed_run():
    """If a complete ModelRun record already exists, ingest_and_process returns
    early without calling the fetcher."""
    from app.models.model_run import RunStatus

    mock_db = AsyncMock()
    existing_run = MagicMock()
    existing_run.status = RunStatus.complete
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = existing_run
    mock_db.execute.return_value = mock_result

    mock_cm = MagicMock()
    mock_cm.__aenter__ = AsyncMock(return_value=mock_db)
    mock_cm.__aexit__ = AsyncMock(return_value=False)

    with (
        patch("app.database.async_session", return_value=mock_cm),
        patch("app.services.ingestion.gfs.GFSFetcher") as mock_gfs_cls,
    ):
        from app.services.scheduler import ingest_and_process

        await ingest_and_process("GFS")

    # The fetcher class should never have been instantiated
    mock_gfs_cls.assert_not_called()


# ---------------------------------------------------------------------------
# ingest_and_process – error handling
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ingest_sets_error_status_on_fetch_failure():
    """A RuntimeError from the fetcher causes run.status to be set to
    RunStatus.error."""
    from app.models.model_run import RunStatus

    run_record = MagicMock()
    run_record.status = RunStatus.pending

    mock_db = AsyncMock()
    mock_db.add = MagicMock()
    mock_db.commit = AsyncMock()
    mock_db.flush = AsyncMock()
    # Return no existing run for every execute() call
    no_result = MagicMock()
    no_result.scalar_one_or_none.return_value = None
    mock_db.execute.return_value = no_result

    mock_cm = MagicMock()
    mock_cm.__aenter__ = AsyncMock(return_value=mock_db)
    mock_cm.__aexit__ = AsyncMock(return_value=False)

    # Mock sqlalchemy.select so it doesn't choke on a MagicMock ModelRun
    mock_stmt = MagicMock()
    mock_stmt.where.return_value = mock_stmt

    with (
        patch("app.database.async_session", return_value=mock_cm),
        patch("app.models.ModelRun", return_value=run_record),
        patch("sqlalchemy.select", return_value=mock_stmt),
        patch(
            "app.services.ingestion.gfs.GFSFetcher.fetch",
            side_effect=RuntimeError("network down"),
        ),
    ):
        from app.services.scheduler import ingest_and_process

        await ingest_and_process("GFS")

    assert run_record.status == RunStatus.error


# ---------------------------------------------------------------------------
# ingest_and_process – return values
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ingest_returns_none_when_already_processed():
    """ingest_and_process returns None (not data) for an already-ingested run."""
    from app.models.model_run import RunStatus

    mock_db = AsyncMock()
    existing_run = MagicMock()
    existing_run.status = RunStatus.complete
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = existing_run
    mock_db.execute.return_value = mock_result

    mock_cm = MagicMock()
    mock_cm.__aenter__ = AsyncMock(return_value=mock_db)
    mock_cm.__aexit__ = AsyncMock(return_value=False)

    with patch("app.database.async_session", return_value=mock_cm):
        from app.services.scheduler import ingest_and_process

        result = await ingest_and_process("GFS")

    assert result is None


@pytest.mark.asyncio
async def test_ingest_returns_none_on_fetch_error():
    """When the fetcher raises, ingest_and_process returns None."""
    run_record = MagicMock()
    run_record.status = "pending"

    mock_db = AsyncMock()
    mock_db.add = MagicMock()
    mock_db.commit = AsyncMock()
    mock_db.flush = AsyncMock()
    no_result = MagicMock()
    no_result.scalar_one_or_none.return_value = None
    mock_db.execute.return_value = no_result

    mock_cm = MagicMock()
    mock_cm.__aenter__ = AsyncMock(return_value=mock_db)
    mock_cm.__aexit__ = AsyncMock(return_value=False)

    mock_stmt = MagicMock()
    mock_stmt.where.return_value = mock_stmt

    with (
        patch("app.database.async_session", return_value=mock_cm),
        patch("app.models.ModelRun", return_value=run_record),
        patch("sqlalchemy.select", return_value=mock_stmt),
        patch(
            "app.services.ingestion.gfs.GFSFetcher.fetch",
            side_effect=RuntimeError("network down"),
        ),
    ):
        from app.services.scheduler import ingest_and_process

        result = await ingest_and_process("GFS")

    assert result is None


# ---------------------------------------------------------------------------
# ingest_and_process – no cross-model re-fetching
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ingest_never_fetches_other_models():
    """ingest_and_process only fetches the requested model — it never
    re-downloads other models for cross-model divergence."""
    import numpy as np
    import xarray as xr

    run_record = MagicMock()
    run_record.status = "pending"

    # Build a minimal dataset with lat/lon coords
    lat = np.array([39.0, 40.0])
    lon = np.array([-75.0, -74.0])
    fetched_data = {
        0: xr.Dataset(
            {
                "precip": xr.DataArray(
                    np.zeros((2, 2)),
                    coords={"latitude": lat, "longitude": lon},
                    dims=["latitude", "longitude"],
                )
            }
        )
    }

    mock_db = AsyncMock()
    mock_db.add = MagicMock()
    mock_db.commit = AsyncMock()
    mock_db.flush = AsyncMock()

    no_result = MagicMock()
    no_result.scalar_one_or_none.return_value = None
    no_result.scalars.return_value.all.return_value = []
    mock_db.execute.return_value = no_result

    mock_cm = MagicMock()
    mock_cm.__aenter__ = AsyncMock(return_value=mock_db)
    mock_cm.__aexit__ = AsyncMock(return_value=False)

    mock_stmt = MagicMock()
    mock_stmt.where.return_value = mock_stmt

    with (
        patch("app.database.async_session", return_value=mock_cm),
        patch("app.models.ModelRun", return_value=run_record),
        patch("sqlalchemy.select", return_value=mock_stmt),
        patch(
            "app.services.ingestion.gfs.GFSFetcher.fetch",
            return_value=fetched_data,
        ),
        patch("app.services.ingestion.nam.NAMFetcher") as mock_nam_cls,
        patch("app.services.ingestion.hrrr.HRRRFetcher") as mock_hrrr_cls,
        patch("app.services.scheduler._clean_herbie_cache"),
    ):
        from app.services.scheduler import ingest_and_process

        await ingest_and_process("GFS")

    # NAM and HRRR fetchers should never be instantiated
    mock_nam_cls.assert_not_called()
    mock_hrrr_cls.assert_not_called()
