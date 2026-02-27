"""Point-level divergence metrics between NWP models."""

import numpy as np
import xarray as xr


def extract_point(ds: xr.Dataset, variable: str, lat: float, lon: float) -> float:
    """Extract scalar value at nearest grid point.

    Handles both 1-D index coordinates (regular lat/lon grids like GFS) and
    2-D auxiliary coordinates (projected grids like NAM CONUSNEST).
    """
    da = ds[variable]
    lat_coord = da.coords.get("latitude")
    lon_coord = da.coords.get("longitude")

    if lat_coord is None or lon_coord is None:
        raise ValueError(
            f"Dataset for {variable} has no latitude/longitude coordinates"
        )

    # 1-D case: latitude and longitude are index dimensions — use fast .sel()
    if lat_coord.ndim == 1:
        val = da.sel(latitude=lat, longitude=lon, method="nearest")
        return float(val.values)

    # 2-D case: projected grid (e.g. Lambert Conformal) — find nearest cell manually
    dist = (lat_coord - lat) ** 2 + (lon_coord - lon) ** 2
    idx = dist.argmin(...)  # returns dict of {dim: index} for all dims
    return float(da.isel(**idx).values)


def compute_pairwise_metrics(
    datasets: dict[str, xr.Dataset],
    variable: str,
    lat: float,
    lon: float,
) -> list[dict]:
    """Compute pairwise RMSE and bias between all model pairs at a point.

    Returns a list of dicts: {model_a, model_b, rmse, bias, val_a, val_b}.
    """
    model_names = sorted(datasets.keys())
    values = {
        name: extract_point(ds, variable, lat, lon)
        for name, ds in datasets.items()
        if variable in ds
    }
    results = []
    for i, a in enumerate(model_names):
        for b in model_names[i + 1 :]:
            if a not in values or b not in values:
                continue
            diff = values[a] - values[b]
            results.append(
                {
                    "model_a": a,
                    "model_b": b,
                    "rmse": abs(diff),  # single-point RMSE = abs difference
                    "bias": diff,
                    "val_a": values[a],
                    "val_b": values[b],
                }
            )
    return results


def compute_ensemble_spread(
    datasets: dict[str, xr.Dataset],
    variable: str,
    lat: float,
    lon: float,
) -> float:
    """Compute std deviation across all model values at a point."""
    values = []
    for ds in datasets.values():
        if variable in ds:
            values.append(extract_point(ds, variable, lat, lon))
    if len(values) < 2:
        return 0.0
    return float(np.std(values, ddof=1))
