"""Tests for divergence computation pipeline logic.

Covers:
* ``_compute_divergence_hours`` – pure function that selects lead hours with
  2+ models (union, not intersection).
* ``_clear_divergence_for_lead_hours`` – DB cleanup that only deletes the
  specified lead hours while preserving data at other hours.
"""

import sys
from datetime import datetime, timezone
from unittest.mock import MagicMock

from sqlalchemy import select

# Stub apscheduler / herbie so importing the scheduler module works.
for _pkg in (
    "apscheduler",
    "apscheduler.schedulers",
    "apscheduler.schedulers.asyncio",
):
    if _pkg not in sys.modules:
        sys.modules[_pkg] = MagicMock()

if "herbie" not in sys.modules:
    sys.modules["herbie"] = MagicMock()

from app.models.divergence import (  # noqa: E402
    GridSnapshot,
    ModelPointValue,
    PointMetric,
)
from app.models.model_run import ModelRun, RunStatus  # noqa: E402


def _utc(*args) -> datetime:
    return datetime(*args, tzinfo=timezone.utc)


INIT_TIME = _utc(2024, 6, 1, 0)


# ---------------------------------------------------------------------------
# _compute_divergence_hours – pure function tests
# ---------------------------------------------------------------------------


def test_divergence_hours_uses_union_not_intersection():
    """Hours that any pair of models shares are included, even if a third
    model doesn't cover that hour."""
    from app.services.scheduler import _compute_divergence_hours

    all_model_data = {
        "GFS": {h: None for h in range(0, 121, 6)},   # 0-120
        "NAM": {h: None for h in range(0, 73, 6)},     # 0-72
        "HRRR": {h: None for h in range(0, 49, 6)},    # 0-48
    }
    result = _compute_divergence_hours(all_model_data)

    # fhr 54-72: GFS + NAM only — must be included
    for h in range(54, 73, 6):
        assert h in result, f"fhr {h} (GFS+NAM) should be in divergence_hours"

    # fhr 0-48: all three models — must be included
    for h in range(0, 49, 6):
        assert h in result, f"fhr {h} (all models) should be in divergence_hours"


def test_divergence_hours_excludes_single_model_hours():
    """Hours covered by only one model are excluded."""
    from app.services.scheduler import _compute_divergence_hours

    all_model_data = {
        "GFS": {h: None for h in range(0, 121, 6)},
        "NAM": {h: None for h in range(0, 49, 6)},
    }
    result = _compute_divergence_hours(all_model_data)

    # fhr 54-120: GFS only — must NOT be included
    for h in range(54, 121, 6):
        assert h not in result, f"fhr {h} (GFS only) should not be included"

    # fhr 0-48: both models — must be included
    for h in range(0, 49, 6):
        assert h in result


def test_divergence_hours_empty_with_single_model():
    """A single model produces an empty set (need 2+ for divergence)."""
    from app.services.scheduler import _compute_divergence_hours

    result = _compute_divergence_hours({"GFS": {0: None, 6: None}})
    assert result == set()


def test_divergence_hours_ecmwf_has_full_coverage():
    """ECMWF (IFS open data) now has the same lead hours as GFS (0-120h).
    All four models overlap at lower hours; GFS+ECMWF cover 78-120h."""
    from app.services.scheduler import _compute_divergence_hours

    # Real model coverage: GFS 0-120, NAM 0-72, HRRR 0-48, ECMWF 0-120
    all_model_data = {
        "GFS": {h: None for h in range(0, 121, 6)},
        "NAM": {h: None for h in range(0, 73, 6)},
        "HRRR": {h: None for h in range(0, 49, 6)},
        "ECMWF": {h: None for h in range(0, 121, 6)},
    }
    result = _compute_divergence_hours(all_model_data)

    assert 0 in result
    assert 6 in result
    assert 48 in result
    assert 54 in result   # GFS + NAM + ECMWF
    assert 72 in result   # GFS + NAM + ECMWF
    assert 78 in result   # GFS + ECMWF (2 models)
    assert 120 in result  # GFS + ECMWF (2 models)


def test_divergence_hours_exact_set():
    """Spot-check the exact output for a known configuration."""
    from app.services.scheduler import _compute_divergence_hours

    all_model_data = {
        "A": {0: None, 6: None, 12: None},
        "B": {0: None, 6: None},
        "C": {12: None, 18: None},
    }
    result = _compute_divergence_hours(all_model_data)

    # 0: A, B  → included
    # 6: A, B  → included
    # 12: A, C → included
    # 18: C    → excluded (only 1 model)
    assert result == {0, 6, 12}


# ---------------------------------------------------------------------------
# _clear_divergence_for_lead_hours – DB integration tests
# ---------------------------------------------------------------------------


async def test_clear_preserves_data_at_other_lead_hours(db):
    """Clearing fhr {0, 6} must not delete data at fhr 12."""
    from app.services.scheduler import _clear_divergence_for_lead_hours

    run_a = ModelRun(
        model_name="GFS", init_time=INIT_TIME,
        forecast_hours=[0, 6, 12], status=RunStatus.complete,
    )
    run_b = ModelRun(
        model_name="NAM", init_time=INIT_TIME,
        forecast_hours=[0, 6, 12], status=RunStatus.complete,
    )
    db.add_all([run_a, run_b])
    await db.commit()

    # Insert metrics at fhr 0, 6, 12
    for fhr in (0, 6, 12):
        db.add(PointMetric(
            run_a_id=run_a.id, run_b_id=run_b.id,
            variable="precip", lat=40.0, lon=-74.0,
            lead_hour=fhr, rmse=1.0, bias=0.5, spread=2.0,
        ))
        db.add(ModelPointValue(
            run_id=run_a.id, variable="precip", lat=40.0, lon=-74.0,
            lead_hour=fhr, value=5.0,
        ))
        db.add(GridSnapshot(
            init_time=INIT_TIME, variable="precip", lead_hour=fhr,
            zarr_path=f"/fake/fhr{fhr:03d}.zarr",
            bbox={"min_lat": 30, "max_lat": 50, "min_lon": -90, "max_lon": -60},
        ))
    await db.commit()

    # Clear only fhr 0 and 6
    await _clear_divergence_for_lead_hours(db, INIT_TIME, {0, 6})
    await db.commit()

    # fhr 12 data must survive
    pm_result = await db.execute(
        select(PointMetric).where(PointMetric.lead_hour == 12)
    )
    assert pm_result.scalars().all(), "PointMetric at fhr 12 must survive"

    mpv_result = await db.execute(
        select(ModelPointValue).where(ModelPointValue.lead_hour == 12)
    )
    assert mpv_result.scalars().all(), "ModelPointValue at fhr 12 must survive"

    gs_result = await db.execute(
        select(GridSnapshot).where(GridSnapshot.lead_hour == 12)
    )
    assert gs_result.scalars().all(), "GridSnapshot at fhr 12 must survive"


async def test_clear_removes_targeted_hours(db):
    """Data at the specified lead hours is fully removed across all tables."""
    from app.services.scheduler import _clear_divergence_for_lead_hours

    run_a = ModelRun(
        model_name="GFS", init_time=INIT_TIME,
        forecast_hours=[0, 6], status=RunStatus.complete,
    )
    run_b = ModelRun(
        model_name="NAM", init_time=INIT_TIME,
        forecast_hours=[0, 6], status=RunStatus.complete,
    )
    db.add_all([run_a, run_b])
    await db.commit()

    for fhr in (0, 6):
        db.add(PointMetric(
            run_a_id=run_a.id, run_b_id=run_b.id,
            variable="precip", lat=40.0, lon=-74.0,
            lead_hour=fhr, rmse=1.0, bias=0.5, spread=2.0,
        ))
        db.add(ModelPointValue(
            run_id=run_a.id, variable="precip", lat=40.0, lon=-74.0,
            lead_hour=fhr, value=5.0,
        ))
        db.add(GridSnapshot(
            init_time=INIT_TIME, variable="precip", lead_hour=fhr,
            zarr_path=f"/fake/fhr{fhr:03d}.zarr",
            bbox={"min_lat": 30, "max_lat": 50, "min_lon": -90, "max_lon": -60},
        ))
    await db.commit()

    await _clear_divergence_for_lead_hours(db, INIT_TIME, {0, 6})
    await db.commit()

    pm_count = len(
        (await db.execute(select(PointMetric))).scalars().all()
    )
    mpv_count = len(
        (await db.execute(select(ModelPointValue))).scalars().all()
    )
    gs_count = len(
        (await db.execute(select(GridSnapshot))).scalars().all()
    )
    assert pm_count == 0, f"Expected 0 PointMetrics, got {pm_count}"
    assert mpv_count == 0, f"Expected 0 ModelPointValues, got {mpv_count}"
    assert gs_count == 0, f"Expected 0 GridSnapshots, got {gs_count}"


async def test_clear_ignores_other_init_times(db):
    """Clearing for one init_time must not touch data at a different init_time."""
    from app.services.scheduler import _clear_divergence_for_lead_hours

    other_time = _utc(2024, 7, 1, 0)

    run = ModelRun(
        model_name="GFS", init_time=other_time,
        forecast_hours=[0], status=RunStatus.complete,
    )
    db.add(run)
    await db.commit()

    db.add(GridSnapshot(
        init_time=other_time, variable="precip", lead_hour=0,
        zarr_path="/fake/other.zarr",
        bbox={"min_lat": 30, "max_lat": 50, "min_lon": -90, "max_lon": -60},
    ))
    await db.commit()

    # Clear for INIT_TIME, not other_time
    await _clear_divergence_for_lead_hours(db, INIT_TIME, {0})
    await db.commit()

    gs_result = await db.execute(select(GridSnapshot))
    assert len(gs_result.scalars().all()) == 1, "Other init_time data must survive"
