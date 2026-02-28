"""Tests for the divergence and forecast API routers.

Uses FastAPI dependency-override injection to replace the DB session with
a mock, avoiding any real database connection.
"""

import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import numpy as np
import xarray as xr
from httpx import ASGITransport, AsyncClient

# Disable the scheduler before the app is imported so no cron jobs start.
os.environ.setdefault("SCHEDULER_ENABLED", "false")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _mock_execute(*, scalars_all=None, scalar_one=None, one=None):
    """Return a MagicMock that mimics an SQLAlchemy AsyncResult."""
    result = MagicMock()
    result.scalars.return_value.all.return_value = (
        scalars_all if scalars_all is not None else []
    )
    result.scalar_one_or_none.return_value = scalar_one
    result.one_or_none.return_value = one
    return result


def _make_session(execute_return=None):
    """Return an AsyncMock session that returns execute_return for every
    execute() call."""
    session = AsyncMock()
    if execute_return is not None:
        session.execute.return_value = execute_return
    return session


@asynccontextmanager
async def _client(session):
    """Async context manager that yields an AsyncClient with a mocked DB session."""
    from app.database import get_db
    from app.main import app

    async def _override():
        yield session

    app.dependency_overrides[get_db] = _override
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client
    app.dependency_overrides.pop(get_db, None)


# ---------------------------------------------------------------------------
# GET /api/divergence/point
# ---------------------------------------------------------------------------


async def test_point_divergence_empty():
    """Returns an empty list when no PointMetric rows match."""
    session = _make_session(_mock_execute(scalars_all=[]))
    async with _client(session) as c:
        resp = await c.get("/api/divergence/point?lat=40.0&lon=-74.0&variable=precip")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_point_divergence_returns_metrics():
    """Serialises PointMetric ORM objects into PointMetricOut JSON."""
    created_at = datetime(2024, 1, 1, tzinfo=timezone.utc)
    pm = MagicMock()
    pm.id = uuid.uuid4()
    pm.run_a_id = uuid.uuid4()
    pm.run_b_id = uuid.uuid4()
    pm.variable = "precip"
    pm.lat = 40.0
    pm.lon = -74.0
    pm.lead_hour = 24
    pm.rmse = 1.5
    pm.bias = -0.5
    pm.spread = 2.0
    pm.created_at = created_at

    session = _make_session(_mock_execute(scalars_all=[pm]))
    async with _client(session) as c:
        resp = await c.get("/api/divergence/point?lat=40.0&lon=-74.0&variable=precip")

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["variable"] == "precip"
    assert data[0]["rmse"] == 1.5
    assert data[0]["bias"] == -0.5
    assert data[0]["spread"] == 2.0


async def test_point_divergence_with_lead_hour_filter():
    """lead_hour query param is accepted and forwarded to the DB query."""
    session = _make_session(_mock_execute(scalars_all=[]))
    async with _client(session) as c:
        resp = await c.get(
            "/api/divergence/point?lat=40.0&lon=-74.0&variable=precip&lead_hour=24"
        )
    assert resp.status_code == 200
    session.execute.assert_awaited_once()


# ---------------------------------------------------------------------------
# GET /api/divergence/grid
# ---------------------------------------------------------------------------


async def test_grid_divergence_not_found():
    """Returns 404 when no GridSnapshot exists for the requested variable/lead_hour."""
    session = _make_session(_mock_execute(scalar_one=None))
    async with _client(session) as c:
        resp = await c.get("/api/divergence/grid?variable=precip&lead_hour=0")
    assert resp.status_code == 404


async def test_grid_divergence_success():
    """Returns GridDivergenceData with latitudes, longitudes, and values."""
    lat = np.arange(35.0, 40.0, 0.25)
    lon = np.arange(-80.0, -75.0, 0.25)
    div_da = xr.DataArray(
        np.ones((len(lat), len(lon))) * 2.0,
        coords={"latitude": lat, "longitude": lon},
        dims=["latitude", "longitude"],
        name="precip_divergence",
    )

    snapshot = MagicMock()
    snapshot.variable = "precip"
    snapshot.lead_hour = 0
    snapshot.init_time = datetime(2024, 1, 1, tzinfo=timezone.utc)
    snapshot.zarr_path = "/fake/path/fhr000.zarr"
    snapshot.bbox = {
        "min_lat": float(lat.min()),
        "max_lat": float(lat.max()),
        "min_lon": float(lon.min()),
        "max_lon": float(lon.max()),
    }

    session = _make_session(_mock_execute(scalar_one=snapshot))
    async with _client(session) as c:
        with patch("app.routers.divergence.load_divergence_zarr", return_value=div_da):
            resp = await c.get("/api/divergence/grid?variable=precip&lead_hour=0")

    assert resp.status_code == 200
    body = resp.json()
    assert body["variable"] == "precip"
    assert body["lead_hour"] == 0
    assert len(body["latitudes"]) == len(lat)
    assert len(body["longitudes"]) == len(lon)
    # values is a 2D list
    assert len(body["values"]) == len(lat)
    assert len(body["values"][0]) == len(lon)


# ---------------------------------------------------------------------------
# GET /api/divergence/grid/snapshots
# ---------------------------------------------------------------------------


async def test_grid_snapshots_empty():
    """Returns an empty list when no GridSnapshot rows exist."""
    session = _make_session(_mock_execute(scalars_all=[]))
    async with _client(session) as c:
        resp = await c.get("/api/divergence/grid/snapshots")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_grid_snapshots_returns_data():
    """Serialises GridSnapshot ORM objects into GridSnapshotOut JSON."""
    snap = MagicMock()
    snap.id = uuid.uuid4()
    snap.init_time = datetime(2024, 1, 1, tzinfo=timezone.utc)
    snap.variable = "mslp"
    snap.lead_hour = 12
    snap.bbox = {"min_lat": 30.0, "max_lat": 50.0, "min_lon": -90.0, "max_lon": -60.0}
    snap.created_at = datetime(2024, 1, 1, tzinfo=timezone.utc)

    session = _make_session(_mock_execute(scalars_all=[snap]))
    async with _client(session) as c:
        resp = await c.get("/api/divergence/grid/snapshots?variable=mslp")

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["variable"] == "mslp"
    assert data[0]["lead_hour"] == 12


# ---------------------------------------------------------------------------
# GET /api/divergence/summary
# ---------------------------------------------------------------------------


async def test_divergence_summary_empty():
    """Returns an empty list when no PointMetric rows exist."""

    def _empty_result():
        r = MagicMock()
        r.all.return_value = []
        return r

    session = AsyncMock()
    # summary endpoint calls execute() once per variable (4 total)
    session.execute.return_value = _empty_result()

    async with _client(session) as c:
        resp = await c.get("/api/divergence/summary")

    assert resp.status_code == 200
    assert resp.json() == []


async def test_divergence_summary_with_data():
    """Returns one DivergenceSummary entry for each variable that has data."""

    def _spread_row(spread_val):
        row = MagicMock()
        row.spread = spread_val
        return row

    def _result_with_rows(rows):
        r = MagicMock()
        r.all.return_value = rows
        return r

    session = AsyncMock()
    # Four variables: precip has spread data, others empty
    session.execute.side_effect = [
        _result_with_rows(  # precip
            [_spread_row(1.0), _spread_row(2.0), _spread_row(3.0)]
        ),
        _result_with_rows([]),  # wind_speed
        _result_with_rows([]),  # mslp
        _result_with_rows([]),  # hgt_500
    ]

    async with _client(session) as c:
        resp = await c.get("/api/divergence/summary")

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["variable"] == "precip"
    assert data[0]["mean_spread"] == 2.0
    assert data[0]["median_spread"] == 2.0
    assert data[0]["max_spread"] == 3.0
    assert data[0]["min_spread"] == 1.0
    assert data[0]["num_points"] == 3
    assert "GFS" in data[0]["models_compared"]


# ---------------------------------------------------------------------------
# GET /api/runs
# ---------------------------------------------------------------------------


async def test_list_runs_empty():
    """Returns an empty list when no ModelRun rows exist."""
    session = _make_session(_mock_execute(scalars_all=[]))
    async with _client(session) as c:
        resp = await c.get("/api/runs")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_runs_returns_runs():
    """Serialises ModelRun ORM objects into ModelRunOut JSON."""
    run = MagicMock()
    run.id = uuid.uuid4()
    run.model_name = "GFS"
    run.init_time = datetime(2024, 1, 1, tzinfo=timezone.utc)
    run.forecast_hours = [0, 6, 12]
    run.status = "complete"
    run.created_at = datetime(2024, 1, 1, tzinfo=timezone.utc)

    session = _make_session(_mock_execute(scalars_all=[run]))
    async with _client(session) as c:
        resp = await c.get("/api/runs")

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["model_name"] == "GFS"
    assert data[0]["forecast_hours"] == [0, 6, 12]


async def test_list_runs_model_name_uppercased():
    """model_name query param is uppercased before filtering."""
    session = _make_session(_mock_execute(scalars_all=[]))
    async with _client(session) as c:
        resp = await c.get("/api/runs?model_name=gfs")
    assert resp.status_code == 200
    # Verify the query was executed (uppercase conversion happens inside the query)
    session.execute.assert_awaited_once()
