"""Tests for Zarr persistence and grid-processing edge cases."""

import numpy as np
import pytest
import xarray as xr

from app.services.processing.grid import (
    compute_grid_divergence,
    load_divergence_zarr,
    regrid_to_common,
    save_divergence_zarr,
)


def _divergence_array(value: float = 2.0) -> xr.DataArray:
    """Return a small synthetic divergence DataArray."""
    lat = np.arange(35.0, 38.0, 0.25)
    lon = np.arange(-80.0, -77.0, 0.25)
    da = xr.DataArray(
        np.full((len(lat), len(lon)), value),
        coords={"latitude": lat, "longitude": lon},
        dims=["latitude", "longitude"],
        name="precip_divergence",
    )
    return da


def _grid_dataset(variable: str, value: float) -> xr.Dataset:
    lat = np.arange(35.0, 40.0, 0.25)
    lon = np.arange(-80.0, -75.0, 0.25)
    data = np.full((len(lat), len(lon)), value)
    da = xr.DataArray(
        data,
        coords={"latitude": lat, "longitude": lon},
        dims=["latitude", "longitude"],
    )
    return xr.Dataset({variable: da})


# ---------------------------------------------------------------------------
# Zarr save / load round-trip
# ---------------------------------------------------------------------------


def test_zarr_roundtrip_preserves_values(tmp_path):
    """Saving and reloading a divergence array produces identical values."""
    original = _divergence_array(2.5)
    zarr_path = save_divergence_zarr(original, tmp_path, "2024010100", "precip", 24)
    loaded = load_divergence_zarr(zarr_path)

    assert np.allclose(original.values, loaded.values)
    np.testing.assert_array_almost_equal(
        original.coords["latitude"].values, loaded.coords["latitude"].values
    )
    np.testing.assert_array_almost_equal(
        original.coords["longitude"].values, loaded.coords["longitude"].values
    )


def test_zarr_path_naming_convention(tmp_path):
    """The returned path encodes init_time, variable, and lead_hour."""
    zarr_path = save_divergence_zarr(
        _divergence_array(), tmp_path, "2024010100", "mslp", 48
    )
    assert "2024010100" in zarr_path
    assert "mslp" in zarr_path
    assert zarr_path.endswith("fhr048.zarr")


def test_zarr_lead_hour_zero_padded(tmp_path):
    """Lead hour is zero-padded to three digits in the file name."""
    zarr_path = save_divergence_zarr(
        _divergence_array(), tmp_path, "2024010100", "precip", 6
    )
    assert zarr_path.endswith("fhr006.zarr")


# ---------------------------------------------------------------------------
# regrid_to_common – edge cases
# ---------------------------------------------------------------------------


def test_regrid_missing_variable_returns_empty():
    """Returns {} when none of the datasets contain the requested variable."""
    datasets = {
        "GFS": _grid_dataset("precip", 10.0),
        "NAM": _grid_dataset("precip", 12.0),
    }
    result = regrid_to_common(datasets, "wind_speed")
    assert result == {}


def test_regrid_partial_missing_variable():
    """Datasets that lack the variable are silently skipped; others are regridded."""
    datasets = {
        "GFS": _grid_dataset("precip", 10.0),
        "NAM": _grid_dataset("wind_speed", 5.0),  # different variable
    }
    result = regrid_to_common(datasets, "precip")
    assert "GFS" in result
    assert "NAM" not in result


# ---------------------------------------------------------------------------
# compute_grid_divergence – existing test improved
# ---------------------------------------------------------------------------


def test_divergence_requires_two_models():
    """Raises ValueError when fewer than two datasets are supplied."""
    with pytest.raises(ValueError, match="at least 2 models"):
        compute_grid_divergence({"GFS": _grid_dataset("precip", 10.0)}, "precip")
