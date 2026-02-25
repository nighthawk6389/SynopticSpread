"""Grid-level divergence computation and Zarr storage."""

import logging
from pathlib import Path

import numpy as np
import xarray as xr

logger = logging.getLogger(__name__)


def regrid_to_common(
    datasets: dict[str, xr.Dataset],
    variable: str,
    resolution: float = 0.25,
) -> dict[str, xr.DataArray]:
    """Regrid all model fields to a common lat/lon grid via
    nearest-neighbor interpolation.

    Uses the intersection of all model bounding boxes at the given resolution.
    """
    # Find common bounding box
    lat_mins, lat_maxs, lon_mins, lon_maxs = [], [], [], []
    for ds in datasets.values():
        if variable not in ds:
            continue
        da = ds[variable]
        lats = da.coords["latitude"].values
        lons = da.coords["longitude"].values
        lat_mins.append(float(np.min(lats)))
        lat_maxs.append(float(np.max(lats)))
        lon_mins.append(float(np.min(lons)))
        lon_maxs.append(float(np.max(lons)))

    if not lat_mins:
        return {}

    common_lat = np.arange(max(lat_mins), min(lat_maxs), resolution)
    common_lon = np.arange(max(lon_mins), min(lon_maxs), resolution)

    regridded = {}
    for name, ds in datasets.items():
        if variable not in ds:
            continue
        regridded[name] = ds[variable].interp(
            latitude=common_lat, longitude=common_lon, method="nearest"
        )
    return regridded


def compute_grid_divergence(
    datasets: dict[str, xr.Dataset],
    variable: str,
    resolution: float = 0.25,
) -> xr.DataArray:
    """Compute per-grid-cell standard deviation across models.

    Returns a 2D DataArray (latitude, longitude) with divergence values.
    """
    regridded = regrid_to_common(datasets, variable, resolution)
    if len(regridded) < 2:
        raise ValueError("Need at least 2 models to compute divergence")

    stacked = xr.concat(list(regridded.values()), dim="model")
    divergence = stacked.std(dim="model", ddof=1)
    divergence.name = f"{variable}_divergence"
    return divergence


def save_divergence_zarr(
    divergence: xr.DataArray,
    store_path: Path,
    init_time_str: str,
    variable: str,
    lead_hour: int,
) -> str:
    """Save divergence DataArray to Zarr store. Returns the Zarr path."""
    zarr_dir = store_path / "divergence" / init_time_str / variable
    zarr_dir.mkdir(parents=True, exist_ok=True)
    zarr_path = zarr_dir / f"fhr{lead_hour:03d}.zarr"

    divergence.to_dataset().to_zarr(str(zarr_path), mode="w")
    logger.info("Saved divergence grid to %s", zarr_path)
    return str(zarr_path)


def load_divergence_zarr(zarr_path: str) -> xr.DataArray:
    """Load a divergence DataArray from Zarr."""
    ds = xr.open_zarr(zarr_path)
    return ds[list(ds.data_vars)[0]]
