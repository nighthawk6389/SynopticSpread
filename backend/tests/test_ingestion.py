"""Tests for NWP data ingestion fetchers.

External dependencies (Herbie, ecmwf-opendata) are mocked so no network calls
are made.  herbie is not installed in the test environment, so it is stubbed at
the sys.modules level before any fetcher modules are imported.
"""

import sys
from datetime import datetime
from unittest.mock import MagicMock, patch

import numpy as np
import pytest
import xarray as xr

# Stub out herbie (not installed in the test environment) before importing any
# fetcher module that has `from herbie import Herbie` at module level.
if "herbie" not in sys.modules:
    sys.modules["herbie"] = MagicMock()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _da(name: str, value: float) -> xr.DataArray:
    """Return a tiny synthetic DataArray."""
    lat = np.array([39.0, 40.0])
    lon = np.array([-75.0, -74.0])
    return xr.DataArray(
        np.full((2, 2), value),
        coords={"latitude": lat, "longitude": lon},
        dims=["latitude", "longitude"],
        name=name,
    )


def _ds(var_name: str, value: float) -> xr.Dataset:
    return xr.Dataset({var_name: _da(var_name, value)})


def _herbie_for(var_datasets: dict) -> MagicMock:
    """Return a mock Herbie instance whose xarray() dispatches on search substrings."""
    h = MagicMock()

    def xarray_side_effect(search):
        for key, ds in var_datasets.items():
            if key in search:
                return ds
        return _ds("unknown", 0.0)

    h.xarray.side_effect = xarray_side_effect
    return h


INIT_TIME = datetime(2024, 1, 1, 0, 0)


# ---------------------------------------------------------------------------
# ModelFetcher.compute_wind_speed  (base-class static method, no external deps)
# ---------------------------------------------------------------------------


def test_compute_wind_speed():
    """Wind speed equals sqrt(u² + v²) — 3-4-5 triangle."""
    from app.services.ingestion.base import ModelFetcher

    ds = xr.Dataset({"u10": _da("u10", 3.0), "v10": _da("v10", 4.0)})
    speed = ModelFetcher.compute_wind_speed(ds, "u10", "v10")
    assert np.allclose(speed.values, 5.0)


# ---------------------------------------------------------------------------
# GFSFetcher
# ---------------------------------------------------------------------------


def test_gfs_fetches_non_wind_variable():
    """GFSFetcher correctly extracts a non-wind variable from a Herbie dataset."""
    from app.services.ingestion.gfs import GFSFetcher

    herbie_inst = _herbie_for({":PRMSL:": _ds("mslp", 101325.0)})
    with patch("app.services.ingestion.gfs.Herbie", return_value=herbie_inst):
        result = GFSFetcher().fetch(INIT_TIME, variables=["mslp"], lead_hours=[0])

    assert 0 in result
    assert "mslp" in result[0]
    assert float(result[0]["mslp"].values.mean()) == pytest.approx(101325.0)


def test_gfs_computes_wind_speed_from_components():
    """GFSFetcher merges U/V components and returns wind_speed via
    compute_wind_speed."""
    from app.services.ingestion.gfs import GFSFetcher

    herbie_inst = _herbie_for(
        {
            ":UGRD:": _ds("u10", 3.0),
            ":VGRD:": _ds("v10", 4.0),
        }
    )
    with patch("app.services.ingestion.gfs.Herbie", return_value=herbie_inst):
        result = GFSFetcher().fetch(INIT_TIME, variables=["wind_speed"], lead_hours=[0])

    assert 0 in result
    assert "wind_speed" in result[0]
    assert np.allclose(result[0]["wind_speed"].values, 5.0)


def test_gfs_failed_lead_hour_is_skipped():
    """A fetch failure for one lead hour is logged and skipped; others succeed."""
    from app.services.ingestion.gfs import GFSFetcher

    call_count = 0

    def herbie_factory(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        h = MagicMock()
        if call_count == 1:
            h.xarray.side_effect = RuntimeError("timeout")
        else:
            h.xarray.return_value = _ds("mslp", 101000.0)
        return h

    with patch("app.services.ingestion.gfs.Herbie", side_effect=herbie_factory):
        result = GFSFetcher().fetch(INIT_TIME, variables=["mslp"], lead_hours=[0, 6])

    assert 0 not in result, "Failed lead hour should be absent from results"
    assert 6 in result, "Successful lead hour should be present in results"


# ---------------------------------------------------------------------------
# NAMFetcher
# ---------------------------------------------------------------------------


def test_nam_fetches_requested_variable():
    """NAMFetcher returns only the variables that were requested."""
    from app.services.ingestion.nam import NAMFetcher

    herbie_inst = _herbie_for({":HGT:": _ds("hgt_500", 5500.0)})
    with patch("app.services.ingestion.nam.Herbie", return_value=herbie_inst):
        result = NAMFetcher().fetch(INIT_TIME, variables=["hgt_500"], lead_hours=[0])

    assert 0 in result
    assert "hgt_500" in result[0]
    assert float(result[0]["hgt_500"].values.mean()) == pytest.approx(5500.0)


# ---------------------------------------------------------------------------
# ECMWFFetcher (ecmwf-opendata / IFS)
# ---------------------------------------------------------------------------


def test_ecmwf_fetches_surface_variables():
    """ECMWFFetcher retrieves surface variables and maps to canonical names."""
    from app.services.ingestion.ecmwf import ECMWFFetcher

    mock_client = MagicMock()
    sfc_ds = xr.Dataset(
        {"tp": _da("tp", 0.005), "msl": _da("msl", 101325.0)}
    )

    with (
        patch("ecmwf.opendata.Client", return_value=mock_client),
        patch("cfgrib.open_datasets", return_value=[sfc_ds]),
    ):
        result = ECMWFFetcher().fetch(
            INIT_TIME, variables=["precip", "mslp"], lead_hours=[0]
        )

    assert 0 in result
    assert "precip" in result[0]
    assert "mslp" in result[0]
    assert float(result[0]["precip"].values.mean()) == pytest.approx(0.005)


def test_ecmwf_computes_wind_speed():
    """ECMWFFetcher computes wind_speed from u10 and v10 components."""
    from app.services.ingestion.ecmwf import ECMWFFetcher

    mock_client = MagicMock()
    sfc_ds = xr.Dataset(
        {"u10": _da("u10", 3.0), "v10": _da("v10", 4.0)}
    )

    with (
        patch("ecmwf.opendata.Client", return_value=mock_client),
        patch("cfgrib.open_datasets", return_value=[sfc_ds]),
    ):
        result = ECMWFFetcher().fetch(
            INIT_TIME, variables=["wind_speed"], lead_hours=[0]
        )

    assert 0 in result
    assert "wind_speed" in result[0]
    assert np.allclose(result[0]["wind_speed"].values, 5.0)


def test_ecmwf_failed_lead_hour_is_skipped():
    """A fetch failure for one lead hour is logged and skipped."""
    from app.services.ingestion.ecmwf import ECMWFFetcher

    call_count = 0
    mock_client = MagicMock()

    def retrieve_side_effect(**kwargs):
        nonlocal call_count
        call_count += 1
        if call_count <= 1:
            raise RuntimeError("download failed")

    mock_client.retrieve = MagicMock(side_effect=retrieve_side_effect)
    sfc_ds = xr.Dataset({"msl": _da("msl", 101000.0)})

    with (
        patch("ecmwf.opendata.Client", return_value=mock_client),
        patch("cfgrib.open_datasets", return_value=[sfc_ds]),
    ):
        result = ECMWFFetcher().fetch(
            INIT_TIME, variables=["mslp"], lead_hours=[0, 6]
        )

    assert 0 not in result, "Failed lead hour should be absent"
    assert 6 in result, "Successful lead hour should be present"
