"""Tests for grid-level divergence computation."""

import numpy as np
import xarray as xr

from app.services.processing.grid import compute_grid_divergence, regrid_to_common


def _make_grid_dataset(variable: str, value: float, offset: float = 0.0) -> xr.Dataset:
    """Create a synthetic 2D dataset on a standard grid."""
    lat = np.arange(35.0, 45.0, 0.25)
    lon = np.arange(-80.0, -70.0, 0.25)
    data = np.full((len(lat), len(lon)), value) + offset
    da = xr.DataArray(data, coords={"latitude": lat, "longitude": lon}, dims=["latitude", "longitude"])
    return xr.Dataset({variable: da})


def test_regrid_to_common():
    datasets = {
        "GFS": _make_grid_dataset("precip", 10.0),
        "NAM": _make_grid_dataset("precip", 12.0),
    }
    regridded = regrid_to_common(datasets, "precip", resolution=0.25)
    assert "GFS" in regridded
    assert "NAM" in regridded
    # Both should have same shape
    assert regridded["GFS"].shape == regridded["NAM"].shape


def test_compute_grid_divergence():
    datasets = {
        "GFS": _make_grid_dataset("precip", 10.0),
        "NAM": _make_grid_dataset("precip", 12.0),
        "ECMWF": _make_grid_dataset("precip", 8.0),
    }
    div = compute_grid_divergence(datasets, "precip")
    assert div.dims == ("latitude", "longitude")
    # std of [10, 12, 8] with ddof=1 = 2.0
    assert np.allclose(div.values, 2.0, atol=1e-6)


def test_divergence_requires_two_models():
    datasets = {"GFS": _make_grid_dataset("precip", 10.0)}
    try:
        compute_grid_divergence(datasets, "precip")
        assert False, "Should have raised ValueError"
    except ValueError:
        pass
