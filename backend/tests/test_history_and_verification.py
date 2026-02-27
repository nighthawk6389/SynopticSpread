"""Tests for the divergence history and verification score endpoints.

Uses the ``db`` and ``http_client`` fixtures from conftest.py (in-memory SQLite).
"""

from datetime import datetime, timezone

import pytest

from app.models.divergence import ModelPointValue, PointMetric
from app.models.model_run import ModelRun, RunStatus


def _utc(*args) -> datetime:
    return datetime(*args, tzinfo=timezone.utc)


def _run(**kwargs) -> ModelRun:
    defaults = dict(
        model_name="GFS",
        init_time=_utc(2024, 1, 15),
        forecast_hours=[0, 6, 12, 24],
        status=RunStatus.complete,
    )
    defaults.update(kwargs)
    return ModelRun(**defaults)


def _metric(run_a_id, run_b_id, **kwargs) -> PointMetric:
    defaults = dict(
        run_a_id=run_a_id,
        run_b_id=run_b_id,
        variable="precip",
        lat=40.71,
        lon=-74.01,
        lead_hour=0,
        rmse=1.5,
        bias=-0.5,
        spread=2.0,
    )
    defaults.update(kwargs)
    return PointMetric(**defaults)


def _mpv(run_id, **kwargs) -> ModelPointValue:
    defaults = dict(
        run_id=run_id,
        variable="precip",
        lat=40.71,
        lon=-74.01,
        lead_hour=0,
        value=5.0,
    )
    defaults.update(kwargs)
    return ModelPointValue(**defaults)


# ---------------------------------------------------------------------------
# GET /api/divergence/history
# ---------------------------------------------------------------------------


async def test_divergence_history_empty(http_client):
    """Returns empty points list when no PointMetric data exists."""
    resp = await http_client.get("/api/divergence/history?variable=precip")
    assert resp.status_code == 200
    body = resp.json()
    assert body["variable"] == "precip"
    assert body["points"] == []


async def test_divergence_history_returns_bucketed_data(http_client, db):
    """Inserts PointMetric rows and checks hourly bucketing."""
    run_a = _run(model_name="GFS")
    run_b = _run(model_name="NAM")
    db.add_all([run_a, run_b])
    await db.commit()

    # Two metrics in the same hour bucket, one in a different hour
    m1 = _metric(run_a.id, run_b.id, spread=2.0)
    m2 = _metric(run_a.id, run_b.id, spread=4.0)
    m3 = _metric(run_a.id, run_b.id, spread=6.0)
    db.add_all([m1, m2, m3])
    await db.commit()

    # Manually set created_at (SQLite doesn't use server_default func.now()
    # the same way, but the rows were just created so created_at ~ now)
    resp = await http_client.get(
        "/api/divergence/history?variable=precip&hours_back=48"
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["variable"] == "precip"
    # All 3 metrics should be in the same hour bucket
    assert len(body["points"]) >= 1
    # The mean spread of 2.0, 4.0, 6.0 = 4.0
    total_mean = sum(p["mean_spread"] for p in body["points"]) / len(body["points"])
    assert total_mean == pytest.approx(4.0, abs=0.01)


# ---------------------------------------------------------------------------
# GET /api/verification/scores
# ---------------------------------------------------------------------------


async def test_verification_scores_empty(http_client):
    """Returns empty scores when no ModelPointValue data exists."""
    resp = await http_client.get(
        "/api/verification/scores?lat=40.71&lon=-74.01&variable=precip"
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["variable"] == "precip"
    assert body["scores"] == []


async def test_verification_scores_computes_correctly(http_client, db):
    """Tests MAE/bias computation for forecast vs analysis verification."""
    # Create two runs for GFS:
    # Run 1: init_time = 2024-01-15 00Z (has forecast at lead_hour=6)
    # Run 2: init_time = 2024-01-15 06Z (has analysis at lead_hour=0)
    # The forecast valid_time = 00Z + 6h = 06Z = Run 2's init_time
    run1 = _run(model_name="GFS", init_time=_utc(2024, 1, 15, 0))
    run2 = _run(model_name="GFS", init_time=_utc(2024, 1, 15, 6))
    db.add_all([run1, run2])
    await db.commit()

    # Forecast: init_time=00Z, lead_hour=6, value=10.0
    # Analysis: init_time=06Z, lead_hour=0, value=8.0
    # Error = 10.0 - 8.0 = 2.0, MAE = 2.0, bias = 2.0
    db.add_all([
        _mpv(run1.id, lead_hour=6, value=10.0),
        _mpv(run2.id, lead_hour=0, value=8.0),
    ])
    await db.commit()

    resp = await http_client.get(
        "/api/verification/scores?lat=40.71&lon=-74.01&variable=precip"
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["scores"]) == 1
    score = body["scores"][0]
    assert score["model_name"] == "GFS"
    assert score["lead_hour"] == 6
    assert score["mae"] == pytest.approx(2.0, abs=0.01)
    assert score["bias"] == pytest.approx(2.0, abs=0.01)
    assert score["n_samples"] == 1


async def test_verification_scores_filters_by_model(http_client, db):
    """Verify model_name query param filters results."""
    run_gfs = _run(model_name="GFS", init_time=_utc(2024, 1, 15, 0))
    run_nam = _run(model_name="NAM", init_time=_utc(2024, 1, 15, 0))
    run_gfs_analysis = _run(model_name="GFS", init_time=_utc(2024, 1, 15, 6))
    run_nam_analysis = _run(model_name="NAM", init_time=_utc(2024, 1, 15, 6))
    db.add_all([run_gfs, run_nam, run_gfs_analysis, run_nam_analysis])
    await db.commit()

    db.add_all([
        _mpv(run_gfs.id, lead_hour=6, value=10.0),
        _mpv(run_gfs_analysis.id, lead_hour=0, value=8.0),
        _mpv(run_nam.id, lead_hour=6, value=12.0),
        _mpv(run_nam_analysis.id, lead_hour=0, value=9.0),
    ])
    await db.commit()

    resp = await http_client.get(
        "/api/verification/scores?lat=40.71&lon=-74.01&variable=precip&model_name=NAM"
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["scores"]) == 1
    assert body["scores"][0]["model_name"] == "NAM"
    assert body["scores"][0]["mae"] == pytest.approx(3.0, abs=0.01)
