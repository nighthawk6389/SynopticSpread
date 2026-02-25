"""Integration tests – real SQLite in-memory DB + full HTTP stack.

Each test exercises at least two application layers together:

* **ORM tests** – SQLAlchemy models ↔ SQLite: verifies that column types,
  defaults, FK references, and JSON round-trips all work correctly.
* **HTTP tests** – FastAPI router ↔ SQLAlchemy ↔ SQLite: drives the full
  request → query-building → DB execution → Pydantic serialisation pipeline
  without mocking the database at all.

The ``db`` and ``http_client`` fixtures are defined in conftest.py.
"""

from datetime import datetime, timezone
from unittest.mock import patch

import numpy as np
import pytest
import xarray as xr
from sqlalchemy import select

from app.models.divergence import GridSnapshot, PointMetric
from app.models.model_run import ModelRun, RunStatus

# ---------------------------------------------------------------------------
# Factory helpers
# ---------------------------------------------------------------------------


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


def _snapshot(**kwargs) -> GridSnapshot:
    defaults = dict(
        init_time=_utc(2024, 1, 15),
        variable="precip",
        lead_hour=0,
        zarr_path="/fake/path.zarr",
        bbox={"min_lat": 30.0, "max_lat": 50.0, "min_lon": -90.0, "max_lon": -60.0},
    )
    defaults.update(kwargs)
    return GridSnapshot(**defaults)


# ---------------------------------------------------------------------------
# ORM layer – direct session operations
# ---------------------------------------------------------------------------


async def test_model_run_insert_and_retrieve(db):
    """All ModelRun columns survive an INSERT → SELECT round-trip."""
    run = _run()
    db.add(run)
    await db.commit()

    result = await db.execute(select(ModelRun).where(ModelRun.id == run.id))
    fetched = result.scalar_one()

    assert fetched.model_name == "GFS"
    assert fetched.init_time == _utc(2024, 1, 15)
    assert fetched.status == RunStatus.complete


async def test_forecast_hours_list_round_trip(db):
    """forecast_hours (stored as JSON via ARRAY patch) is retrieved as a list."""
    hours = [0, 6, 12, 24, 48, 72]
    run = _run(forecast_hours=hours)
    db.add(run)
    await db.commit()

    result = await db.execute(select(ModelRun).where(ModelRun.id == run.id))
    assert result.scalar_one().forecast_hours == hours


async def test_model_run_status_defaults_to_pending(db):
    """Status defaults to 'pending' when not supplied at insert time."""
    run = ModelRun(
        model_name="NAM",
        init_time=_utc(2024, 1, 15),
        forecast_hours=[0],
    )
    db.add(run)
    await db.commit()

    result = await db.execute(select(ModelRun).where(ModelRun.id == run.id))
    assert result.scalar_one().status == RunStatus.pending


async def test_point_metric_fk_references_stored_correctly(db):
    """PointMetric.run_a_id / run_b_id are persisted and retrieved as UUIDs."""
    run_a = _run(model_name="GFS")
    run_b = _run(model_name="NAM")
    db.add_all([run_a, run_b])
    await db.commit()

    metric = _metric(run_a_id=run_a.id, run_b_id=run_b.id)
    db.add(metric)
    await db.commit()

    result = await db.execute(select(PointMetric).where(PointMetric.id == metric.id))
    fetched = result.scalar_one()
    assert fetched.run_a_id == run_a.id
    assert fetched.run_b_id == run_b.id
    assert fetched.variable == "precip"


async def test_grid_snapshot_bbox_json_round_trip(db):
    """GridSnapshot.bbox dict is stored as JSON and retrieved as a dict."""
    bbox = {"min_lat": 25.0, "max_lat": 50.0, "min_lon": -125.0, "max_lon": -65.0}
    snap = _snapshot(bbox=bbox)
    db.add(snap)
    await db.commit()

    result = await db.execute(select(GridSnapshot).where(GridSnapshot.id == snap.id))
    assert result.scalar_one().bbox == bbox


async def test_multiple_runs_queryable_by_model_name(db):
    """Multiple ModelRun rows can be filtered by model_name."""
    db.add_all([
        _run(model_name="GFS"), _run(model_name="NAM"), _run(model_name="ECMWF"),
    ])
    await db.commit()

    result = await db.execute(
        select(ModelRun).where(ModelRun.model_name == "NAM")
    )
    rows = result.scalars().all()
    assert len(rows) == 1
    assert rows[0].model_name == "NAM"


# ---------------------------------------------------------------------------
# HTTP layer – full request → router → SQLAlchemy → SQLite → JSON response
# ---------------------------------------------------------------------------


# --- /api/runs ---

async def test_get_runs_empty_database(http_client):
    """/api/runs returns an empty list when no rows exist."""
    resp = await http_client.get("/api/runs")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_get_runs_returns_inserted_run(http_client, db):
    """Data inserted through the session is visible in /api/runs JSON output."""
    run = _run(forecast_hours=[0, 6, 12])
    db.add(run)
    await db.commit()

    resp = await http_client.get("/api/runs")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["model_name"] == "GFS"
    assert data[0]["forecast_hours"] == [0, 6, 12]
    assert data[0]["status"] == "complete"


async def test_get_runs_filter_by_model_name(http_client, db):
    """model_name query parameter returns only matching runs."""
    db.add_all([_run(model_name="GFS"), _run(model_name="NAM")])
    await db.commit()

    resp = await http_client.get("/api/runs?model_name=NAM")
    data = resp.json()
    assert len(data) == 1
    assert data[0]["model_name"] == "NAM"


async def test_get_runs_model_name_filter_is_case_insensitive(http_client, db):
    """Lowercase model_name is uppercased before the DB query."""
    db.add(_run(model_name="GFS"))
    await db.commit()

    resp = await http_client.get("/api/runs?model_name=gfs")
    assert resp.status_code == 200
    assert resp.json()[0]["model_name"] == "GFS"


async def test_get_runs_ordered_newest_first(http_client, db):
    """Runs are returned in descending init_time order."""
    db.add_all([
        _run(model_name="OLD", init_time=_utc(2024, 1, 14)),
        _run(model_name="NEW", init_time=_utc(2024, 1, 15)),
    ])
    await db.commit()

    names = [r["model_name"] for r in (await http_client.get("/api/runs")).json()]
    assert names == ["NEW", "OLD"]


async def test_get_runs_since_filter(http_client, db):
    """since query parameter excludes runs with earlier init_time."""
    db.add_all([
        _run(model_name="OLD", init_time=_utc(2024, 1, 13)),
        _run(model_name="NEW", init_time=_utc(2024, 1, 15)),
    ])
    await db.commit()

    resp = await http_client.get("/api/runs?since=2024-01-14T00:00:00Z")
    data = resp.json()
    assert len(data) == 1
    assert data[0]["model_name"] == "NEW"


# --- /api/divergence/point ---

async def test_get_point_divergence_returns_metric(http_client, db):
    """Point divergence metrics are returned when the query coordinates match."""
    run_a = _run(model_name="GFS")
    run_b = _run(model_name="NAM")
    db.add_all([run_a, run_b])
    await db.commit()

    db.add(_metric(run_a_id=run_a.id, run_b_id=run_b.id, spread=3.5, rmse=1.2))
    await db.commit()

    resp = await http_client.get(
        "/api/divergence/point?lat=40.71&lon=-74.01&variable=precip"
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["spread"] == pytest.approx(3.5)
    assert data[0]["rmse"] == pytest.approx(1.2)
    assert data[0]["variable"] == "precip"


async def test_get_point_divergence_excludes_distant_point(http_client, db):
    """A metric more than 0.5° away from the query coordinates is excluded."""
    run_a = _run(model_name="GFS")
    run_b = _run(model_name="NAM")
    db.add_all([run_a, run_b])
    await db.commit()

    db.add_all([
        _metric(run_a_id=run_a.id, run_b_id=run_b.id, lat=40.71, lon=-74.01),
        _metric(run_a_id=run_a.id, run_b_id=run_b.id, lat=34.05, lon=-118.24),
    ])
    await db.commit()

    resp = await http_client.get(
        "/api/divergence/point?lat=40.71&lon=-74.01&variable=precip"
    )
    data = resp.json()
    assert len(data) == 1
    assert abs(data[0]["lat"] - 40.71) <= 0.5


async def test_get_point_divergence_lead_hour_filter(http_client, db):
    """lead_hour query parameter excludes metrics at other lead hours."""
    run_a = _run(model_name="GFS")
    run_b = _run(model_name="NAM")
    db.add_all([run_a, run_b])
    await db.commit()

    db.add_all([
        _metric(run_a_id=run_a.id, run_b_id=run_b.id, lead_hour=0),
        _metric(run_a_id=run_a.id, run_b_id=run_b.id, lead_hour=24),
    ])
    await db.commit()

    resp = await http_client.get(
        "/api/divergence/point?lat=40.71&lon=-74.01&variable=precip&lead_hour=24"
    )
    data = resp.json()
    assert len(data) == 1
    assert data[0]["lead_hour"] == 24


async def test_get_point_divergence_empty_when_variable_mismatch(http_client, db):
    """Query for a variable with no data returns an empty list."""
    run_a = _run(model_name="GFS")
    run_b = _run(model_name="NAM")
    db.add_all([run_a, run_b])
    await db.commit()

    db.add(_metric(run_a_id=run_a.id, run_b_id=run_b.id, variable="precip"))
    await db.commit()

    resp = await http_client.get(
        "/api/divergence/point?lat=40.71&lon=-74.01&variable=wind_speed"
    )
    assert resp.status_code == 200
    assert resp.json() == []


# --- /api/divergence/summary ---

async def test_divergence_summary_includes_variable_with_data(http_client, db):
    """A variable that has PointMetric rows appears in the summary."""
    run_a = _run(model_name="GFS")
    run_b = _run(model_name="NAM")
    db.add_all([run_a, run_b])
    await db.commit()

    db.add(_metric(run_a_id=run_a.id, run_b_id=run_b.id, variable="precip", spread=2.0))
    await db.commit()

    resp = await http_client.get("/api/divergence/summary")
    assert resp.status_code == 200
    variables = [s["variable"] for s in resp.json()]
    assert "precip" in variables


async def test_divergence_summary_excludes_variables_without_data(http_client, db):
    """Variables with no metrics are omitted from the summary."""
    run_a = _run(model_name="GFS")
    run_b = _run(model_name="NAM")
    db.add_all([run_a, run_b])
    await db.commit()

    db.add(_metric(run_a_id=run_a.id, run_b_id=run_b.id, variable="precip"))
    await db.commit()

    resp = await http_client.get("/api/divergence/summary")
    variables = [s["variable"] for s in resp.json()]
    for absent in ("wind_speed", "mslp", "hgt_500"):
        assert absent not in variables


async def test_divergence_summary_computes_correct_aggregates(http_client, db):
    """mean_spread, max_spread, and num_points are aggregated correctly."""
    run_a = _run(model_name="GFS")
    run_b = _run(model_name="NAM")
    db.add_all([run_a, run_b])
    await db.commit()

    db.add_all([
        _metric(run_a_id=run_a.id, run_b_id=run_b.id, variable="precip", spread=1.0),
        _metric(run_a_id=run_a.id, run_b_id=run_b.id, variable="precip", spread=3.0),
    ])
    await db.commit()

    resp = await http_client.get("/api/divergence/summary")
    summary = next(s for s in resp.json() if s["variable"] == "precip")
    assert summary["num_points"] == 2
    assert summary["mean_spread"] == pytest.approx(2.0, abs=1e-3)
    assert summary["max_spread"] == pytest.approx(3.0, abs=1e-3)
    assert "GFS" in summary["models_compared"]


# --- /api/divergence/grid/snapshots ---

async def test_list_grid_snapshots_returns_inserted_data(http_client, db):
    """Inserted GridSnapshot rows appear in the snapshots list endpoint."""
    db.add(_snapshot(variable="precip", lead_hour=12))
    await db.commit()

    resp = await http_client.get("/api/divergence/grid/snapshots")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["variable"] == "precip"
    assert data[0]["lead_hour"] == 12


async def test_list_grid_snapshots_variable_filter(http_client, db):
    """variable query parameter returns only snapshots for that variable."""
    db.add_all([_snapshot(variable="precip"), _snapshot(variable="wind_speed")])
    await db.commit()

    resp = await http_client.get("/api/divergence/grid/snapshots?variable=precip")
    data = resp.json()
    assert len(data) == 1
    assert data[0]["variable"] == "precip"


async def test_list_grid_snapshots_empty_database(http_client):
    """Returns an empty list when no GridSnapshot rows exist."""
    resp = await http_client.get("/api/divergence/grid/snapshots")
    assert resp.status_code == 200
    assert resp.json() == []


# --- /api/divergence/grid ---

async def test_get_grid_divergence_404_when_no_snapshot(http_client):
    """Returns 404 when no GridSnapshot matches the requested variable/lead_hour."""
    resp = await http_client.get("/api/divergence/grid?variable=precip&lead_hour=0")
    assert resp.status_code == 404


async def test_get_grid_divergence_returns_full_response(http_client, db):
    """With a snapshot in the DB and a mocked Zarr load, the full grid response
    is serialised correctly (variable, lead_hour, latitudes, longitudes, values,
    bbox)."""
    snap = _snapshot(variable="precip", lead_hour=0, zarr_path="/fake/zarr")
    db.add(snap)
    await db.commit()

    lat = np.linspace(35.0, 40.0, 4)
    lon = np.linspace(-80.0, -75.0, 4)
    da = xr.DataArray(
        np.ones((len(lat), len(lon))),
        coords={"latitude": lat, "longitude": lon},
        dims=["latitude", "longitude"],
    )

    with patch("app.routers.divergence.load_divergence_zarr", return_value=da):
        resp = await http_client.get("/api/divergence/grid?variable=precip&lead_hour=0")

    assert resp.status_code == 200
    body = resp.json()
    assert body["variable"] == "precip"
    assert body["lead_hour"] == 0
    assert len(body["latitudes"]) == len(lat)
    assert len(body["longitudes"]) == len(lon)
    assert len(body["values"]) == len(lat)
    assert body["bbox"] == snap.bbox
