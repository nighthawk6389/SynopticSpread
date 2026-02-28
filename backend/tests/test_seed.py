"""Tests for the startup data seeding logic."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

_INGEST_PATH = "app.services.scheduler.ingest_and_process"


@pytest.mark.asyncio
async def test_seed_skips_when_data_exists():
    """_seed_initial_data does nothing if ModelRun rows already exist."""
    mock_db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar.return_value = 5
    mock_db.execute.return_value = mock_result

    mock_cm = MagicMock()
    mock_cm.__aenter__ = AsyncMock(return_value=mock_db)
    mock_cm.__aexit__ = AsyncMock(return_value=False)

    with (
        patch("app.main.asyncio.sleep", new_callable=AsyncMock),
        patch("app.database.async_session", return_value=mock_cm),
        patch(_INGEST_PATH, new_callable=AsyncMock) as mock_ingest,
    ):
        from app.main import _seed_initial_data

        await _seed_initial_data()

    mock_ingest.assert_not_called()


@pytest.mark.asyncio
async def test_seed_triggers_all_models_when_empty():
    """_seed_initial_data triggers all models when DB is empty."""
    mock_db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar.return_value = 0
    mock_db.execute.return_value = mock_result

    mock_cm = MagicMock()
    mock_cm.__aenter__ = AsyncMock(return_value=mock_db)
    mock_cm.__aexit__ = AsyncMock(return_value=False)

    with (
        patch("app.main.asyncio.sleep", new_callable=AsyncMock),
        patch("app.database.async_session", return_value=mock_cm),
        patch("app.main.settings"),
        patch(_INGEST_PATH, new_callable=AsyncMock) as mock_ingest,
    ):
        from app.main import _seed_initial_data

        await _seed_initial_data()

    called_models = [c.args[0] for c in mock_ingest.call_args_list]
    assert "GFS" in called_models
    assert "NAM" in called_models
    assert "HRRR" in called_models
    assert "ECMWF" in called_models
    assert "AIGFS" in called_models
    assert "RRFS" in called_models


@pytest.mark.asyncio
async def test_seed_continues_on_individual_model_failure():
    """If one model fails, the others still get triggered."""
    mock_db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar.return_value = 0
    mock_db.execute.return_value = mock_result

    mock_cm = MagicMock()
    mock_cm.__aenter__ = AsyncMock(return_value=mock_db)
    mock_cm.__aexit__ = AsyncMock(return_value=False)

    async def _ingest_side_effect(model, **kwargs):
        if model == "GFS":
            raise RuntimeError("GFS failed")

    with (
        patch("app.main.asyncio.sleep", new_callable=AsyncMock),
        patch("app.database.async_session", return_value=mock_cm),
        patch("app.main.settings"),
        patch(
            _INGEST_PATH,
            new_callable=AsyncMock,
            side_effect=_ingest_side_effect,
        ) as mock_ingest,
    ):
        from app.main import _seed_initial_data

        await _seed_initial_data()

    # All 6 models attempted even though GFS raised
    assert mock_ingest.call_count == 6


# ---------------------------------------------------------------------------
# Seed data accumulation – other_model_data grows as models succeed
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_seed_passes_accumulated_data_to_each_model():
    """Each successive ingest_and_process call receives the data returned
    by all previously successful models via other_model_data.

    Because _seed_initial_data mutates the same dict, we capture a snapshot
    of the keys at each call using the side_effect.
    """
    mock_db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar.return_value = 0
    mock_db.execute.return_value = mock_result

    mock_cm = MagicMock()
    mock_cm.__aenter__ = AsyncMock(return_value=mock_db)
    mock_cm.__aexit__ = AsyncMock(return_value=False)

    gfs_data = {0: "gfs_ds_0", 6: "gfs_ds_6"}
    nam_data = {0: "nam_ds_0", 6: "nam_ds_6"}
    hrrr_data = {0: "hrrr_ds_0"}
    ecmwf_data = {0: "ecmwf_ds_0", 6: "ecmwf_ds_6"}
    aigfs_data = {0: "aigfs_ds_0", 6: "aigfs_ds_6"}
    rrfs_data = {0: "rrfs_ds_0", 6: "rrfs_ds_6"}

    # Capture a snapshot of other_model_data keys at each call
    snapshots: list[set[str]] = []

    async def _ingest_side_effect(model, **kwargs):
        other = kwargs.get("other_model_data", {})
        snapshots.append(set(other.keys()))
        return {
            "GFS": gfs_data,
            "NAM": nam_data,
            "HRRR": hrrr_data,
            "ECMWF": ecmwf_data,
            "AIGFS": aigfs_data,
            "RRFS": rrfs_data,
        }[model]

    with (
        patch("app.main.asyncio.sleep", new_callable=AsyncMock),
        patch("app.database.async_session", return_value=mock_cm),
        patch("app.main.settings"),
        patch(
            _INGEST_PATH,
            new_callable=AsyncMock,
            side_effect=_ingest_side_effect,
        ),
    ):
        from app.main import _seed_initial_data

        await _seed_initial_data()

    assert len(snapshots) == 6

    # GFS (1st): no prior data
    assert snapshots[0] == set()

    # NAM (2nd): GFS already fetched
    assert snapshots[1] == {"GFS"}

    # HRRR (3rd): GFS + NAM already fetched
    assert snapshots[2] == {"GFS", "NAM"}

    # ECMWF (4th): GFS + NAM + HRRR already fetched
    assert snapshots[3] == {"GFS", "NAM", "HRRR"}

    # AIGFS (5th): GFS + NAM + HRRR + ECMWF already fetched
    assert snapshots[4] == {"GFS", "NAM", "HRRR", "ECMWF"}

    # RRFS (6th): all 5 prior models already fetched
    assert snapshots[5] == {"GFS", "NAM", "HRRR", "ECMWF", "AIGFS"}


@pytest.mark.asyncio
async def test_seed_excludes_failed_model_from_accumulated_data():
    """If a model's ingest raises, its data is NOT passed to subsequent
    models via other_model_data."""
    mock_db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar.return_value = 0
    mock_db.execute.return_value = mock_result

    mock_cm = MagicMock()
    mock_cm.__aenter__ = AsyncMock(return_value=mock_db)
    mock_cm.__aexit__ = AsyncMock(return_value=False)

    nam_data = {0: "nam_ds_0"}

    async def _ingest_side_effect(model, **kwargs):
        if model == "GFS":
            raise RuntimeError("GFS download failed")
        return {
            "NAM": nam_data,
            "HRRR": {0: "hrrr"},
            "ECMWF": {0: "ecmwf"},
            "AIGFS": {0: "aigfs"},
            "RRFS": {0: "rrfs"},
        }[model]

    with (
        patch("app.main.asyncio.sleep", new_callable=AsyncMock),
        patch("app.database.async_session", return_value=mock_cm),
        patch("app.main.settings"),
        patch(
            _INGEST_PATH,
            new_callable=AsyncMock,
            side_effect=_ingest_side_effect,
        ) as mock_ingest,
    ):
        from app.main import _seed_initial_data

        await _seed_initial_data()

    calls = mock_ingest.call_args_list

    # NAM (2nd): GFS failed, so other_model_data should be empty
    nam_other = calls[1].kwargs["other_model_data"]
    assert "GFS" not in nam_other

    # HRRR (3rd): only NAM succeeded, so other_model_data has NAM only
    hrrr_other = calls[2].kwargs["other_model_data"]
    assert "GFS" not in hrrr_other
    assert "NAM" in hrrr_other

    # ECMWF (4th): NAM + HRRR succeeded
    ecmwf_other = calls[3].kwargs["other_model_data"]
    assert "GFS" not in ecmwf_other
    assert "NAM" in ecmwf_other
    assert "HRRR" in ecmwf_other


@pytest.mark.asyncio
async def test_seed_excludes_none_return_from_accumulated_data():
    """If ingest_and_process returns None (already processed), it is not
    added to the accumulated data."""
    mock_db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar.return_value = 0
    mock_db.execute.return_value = mock_result

    mock_cm = MagicMock()
    mock_cm.__aenter__ = AsyncMock(return_value=mock_db)
    mock_cm.__aexit__ = AsyncMock(return_value=False)

    nam_data = {0: "nam_ds_0"}

    async def _ingest_side_effect(model, **kwargs):
        if model == "GFS":
            return None  # already ingested
        return {
            "NAM": nam_data,
            "HRRR": {0: "hrrr"},
            "ECMWF": {0: "ecmwf"},
            "AIGFS": {0: "aigfs"},
            "RRFS": {0: "rrfs"},
        }[model]

    with (
        patch("app.main.asyncio.sleep", new_callable=AsyncMock),
        patch("app.database.async_session", return_value=mock_cm),
        patch("app.main.settings"),
        patch(
            _INGEST_PATH,
            new_callable=AsyncMock,
            side_effect=_ingest_side_effect,
        ) as mock_ingest,
    ):
        from app.main import _seed_initial_data

        await _seed_initial_data()

    calls = mock_ingest.call_args_list

    # NAM (2nd): GFS returned None → not in other_model_data
    nam_other = calls[1].kwargs["other_model_data"]
    assert "GFS" not in nam_other

    # HRRR (3rd): only NAM has data
    hrrr_other = calls[2].kwargs["other_model_data"]
    assert "GFS" not in hrrr_other
    assert "NAM" in hrrr_other

    # ECMWF (4th): NAM + HRRR have data
    ecmwf_other = calls[3].kwargs["other_model_data"]
    assert "GFS" not in ecmwf_other
    assert "NAM" in ecmwf_other
    assert "HRRR" in ecmwf_other
