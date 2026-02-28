import warnings
from abc import ABC, abstractmethod
from datetime import datetime

import xarray as xr

# Silence xarray/cfgrib FutureWarnings about merge compat defaults.
# These fire on every xr.merge() call and clutter logs without being actionable
# until the xarray breaking change actually lands.
warnings.filterwarnings("ignore", category=FutureWarning, module=r"xarray\.")
warnings.filterwarnings("ignore", category=FutureWarning, module=r"cfgrib\.")

# Canonical variable names used throughout the application
VARIABLES = {
    "precip": "Total precipitation",
    "wind_speed": "10m wind speed",
    "mslp": "Mean sea-level pressure",
    "hgt_500": "500mb geopotential height",
}

# Standard forecast lead hours to fetch
DEFAULT_LEAD_HOURS = list(range(0, 121, 6))  # 0 to 120h in 6h steps


class ModelFetcher(ABC):
    """Abstract base class for NWP model data fetchers."""

    name: str  # e.g. "GFS", "NAM", "ECMWF"

    @abstractmethod
    def fetch(
        self,
        init_time: datetime,
        variables: list[str],
        lead_hours: list[int],
    ) -> dict[int, xr.Dataset]:
        """Fetch model data for a given initialization time.

        Returns a dict mapping lead_hour -> xr.Dataset with canonical variable names.
        Each Dataset should have (latitude, longitude) coordinates.
        """
        ...

    @staticmethod
    def compute_wind_speed(ds: xr.Dataset, u_var: str, v_var: str) -> xr.DataArray:
        """Compute wind speed from U and V components."""
        import numpy as np

        return np.sqrt(ds[u_var] ** 2 + ds[v_var] ** 2)
