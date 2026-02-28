"""Tests for the startup data seeding logic."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

_INGEST_PATH = "app.services.scheduler.ingest_and_process"
_DIVERGENCE_PATH = "app.services.scheduler.recompute_cycle_divergence"


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
        patch(_DIVERGENCE_PATH, new_callable=AsyncMock),
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
        patch(_DIVERGENCE_PATH, new_callable=AsyncMock),
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
        patch(_DIVERGENCE_PATH, new_callable=AsyncMock),
    ):
        from app.main import _seed_initial_data

        await _seed_initial_data()

    # All 6 models attempted even though GFS raised
    assert mock_ingest.call_count == 6


# ---------------------------------------------------------------------------
# Seed does NOT accumulate model data (memory-efficient design)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_seed_does_not_pass_other_model_data():
    """No other_model_data is passed — each model ingests independently."""
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
        patch(_DIVERGENCE_PATH, new_callable=AsyncMock),
    ):
        from app.main import _seed_initial_data

        await _seed_initial_data()

    for call in mock_ingest.call_args_list:
        # No other_model_data kwarg should be present
        assert "other_model_data" not in call.kwargs


@pytest.mark.asyncio
async def test_seed_calls_recompute_divergence_after_models():
    """After all models are ingested, recompute_cycle_divergence is called."""
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
        patch(_INGEST_PATH, new_callable=AsyncMock),
        patch(_DIVERGENCE_PATH, new_callable=AsyncMock) as mock_divergence,
    ):
        from app.main import _seed_initial_data

        await _seed_initial_data()

    # recompute_cycle_divergence is called at least once (for each unique init_time)
    assert mock_divergence.call_count >= 1
