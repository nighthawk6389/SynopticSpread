"""Tests for point-level divergence metrics."""

import numpy as np
import xarray as xr

from app.services.processing.metrics import (
    compute_ensemble_spread,
    compute_pairwise_metrics,
    extract_point,
)


def _make_dataset(variable: str, value: float) -> xr.Dataset:
    """Create a small synthetic Dataset with a single variable."""
    lat = np.array([39.0, 40.0, 41.0])
    lon = np.array([-75.0, -74.0, -73.0])
    data = np.full((3, 3), value)
    da = xr.DataArray(
        data, coords={"latitude": lat, "longitude": lon}, dims=["latitude", "longitude"]
    )
    return xr.Dataset({variable: da})


def test_extract_point():
    ds = _make_dataset("precip", 5.0)
    val = extract_point(ds, "precip", 40.0, -74.0)
    assert val == 5.0


def test_extract_point_nearest():
    ds = _make_dataset("precip", 5.0)
    # Slightly off-grid should snap to nearest
    val = extract_point(ds, "precip", 40.1, -73.9)
    assert val == 5.0


def test_pairwise_metrics():
    datasets = {
        "GFS": _make_dataset("precip", 10.0),
        "NAM": _make_dataset("precip", 12.0),
        "ECMWF": _make_dataset("precip", 8.0),
    }
    results = compute_pairwise_metrics(datasets, "precip", 40.0, -74.0)
    # 3 models → 3 pairs
    assert len(results) == 3

    # Check ECMWF-GFS pair
    eg = next(r for r in results if r["model_a"] == "ECMWF" and r["model_b"] == "GFS")
    assert eg["rmse"] == 2.0
    assert eg["bias"] == -2.0


def test_ensemble_spread():
    datasets = {
        "GFS": _make_dataset("mslp", 101300.0),
        "NAM": _make_dataset("mslp", 101500.0),
        "ECMWF": _make_dataset("mslp", 101100.0),
    }
    spread = compute_ensemble_spread(datasets, "mslp", 40.0, -74.0)
    # std of [101300, 101500, 101100] with ddof=1 = 200
    assert abs(spread - 200.0) < 1e-6


def test_spread_single_model():
    datasets = {"GFS": _make_dataset("precip", 5.0)}
    spread = compute_ensemble_spread(datasets, "precip", 40.0, -74.0)
    assert spread == 0.0
