"""RRFS (Rapid Refresh Forecast System) fetcher.

Herbie 2026.1.1's RRFS template is outdated — it looks for data under
``rrfs_a/rrfs_a.YYYYMMDD/HH/{member}/`` which no longer exists.  Actual
deterministic data lives at ``rrfs_a/rrfs.YYYYMMDD/HH/`` with 3km filenames.

This module monkey-patches Herbie's ``rrfs`` template at import time so that
we can still use Herbie's ``.idx`` parsing, subsetting, and xarray integration.
"""

import gc
import logging
from datetime import datetime

import xarray as xr
from herbie import Herbie

from app.services.ingestion.base import ModelFetcher

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Monkey-patch Herbie's RRFS template to match the current S3 layout.
# ---------------------------------------------------------------------------

_RRFS_HELP = """Corrected RRFS template for rrfs_a/rrfs.YYYYMMDD layout."""


def _patched_template(self):
    """Generate correct S3 URLs for the deterministic RRFS run."""
    self.DESCRIPTION = "Rapid Refresh Forecast System (RRFS)"
    self.DETAILS = {
        "aws product description": "https://registry.opendata.aws/noaa-rrfs/",
    }
    self.HELP = _RRFS_HELP

    self.PRODUCTS = {
        "prslev": "Pressure level fields",
        "natlev": "Native level fields",
        "testbed": "Testbed fields",
    }

    if self.product == "prs":
        self.product = "prslev"
    elif self.product == "nat":
        self.product = "natlev"

    # Map domain to filename suffix + resolution
    domain_map = {
        "conus": ("conus", "3km"),
        "alaska": ("ak", "3km"),
        "ak": ("ak", "3km"),
        "na": ("na", "3km"),
        "hawaii": ("hi", "2p5km"),
        "hi": ("hi", "2p5km"),
        "puerto rico": ("pr", "2p5km"),
        "pr": ("pr", "2p5km"),
        None: ("conus", "3km"),
    }
    raw_domain = getattr(self, "domain", None)
    domain_suffix, resolution = domain_map.get(
        raw_domain, (raw_domain or "conus", "3km")
    )

    # Corrected URL: rrfs_a/rrfs.YYYYMMDD/HH/ (no member subdir, with resolution)
    url = (
        f"https://noaa-rrfs-pds.s3.amazonaws.com/"
        f"rrfs_a/rrfs.{self.date:%Y%m%d/%H}/"
        f"rrfs.t{self.date:%H}z.{self.product}.{resolution}."
        f"f{self.fxx:03d}.{domain_suffix}.grib2"
    )

    self.SOURCES = {"aws": url}
    self.LOCALFILE = f"rrfs/{self.get_remoteFileName}"


# Apply the patch — import may fail in test environments where herbie is mocked.
try:
    from herbie.models import rrfs as _rrfs_cls

    _rrfs_cls.template = _patched_template
except (ImportError, AttributeError):
    pass

# ---------------------------------------------------------------------------
# RRFS search patterns and fetcher
# ---------------------------------------------------------------------------

# RRFS uses MSLET (not PRMSL) for mean sea-level pressure.
RRFS_SEARCH = {
    "precip": ":APCP:surface:0-",
    "wind_u": ":UGRD:10 m above ground",
    "wind_v": ":VGRD:10 m above ground",
    "mslp": ":MSLET:mean sea level",
    "hgt_500": ":HGT:500 mb",
}

# RRFS extended runs: 0-60h in 6h steps at 00/06/12/18Z
RRFS_LEAD_HOURS = list(range(0, 61, 6))


class RRFSFetcher(ModelFetcher):
    name = "RRFS"

    def fetch(
        self,
        init_time: datetime,
        variables: list[str] | None = None,
        lead_hours: list[int] | None = None,
    ) -> dict[int, xr.Dataset]:
        lead_hours = lead_hours or RRFS_LEAD_HOURS
        variables = variables or ["precip", "wind_speed", "mslp", "hgt_500"]
        results: dict[int, xr.Dataset] = {}

        for fhr in lead_hours:
            try:
                h = Herbie(
                    init_time.replace(tzinfo=None),
                    model="rrfs",
                    product="prslev",
                    fxx=fhr,
                )
                arrays: dict[str, xr.DataArray] = {}

                for var in variables:
                    if var == "wind_speed":
                        ds_u = h.xarray(RRFS_SEARCH["wind_u"])
                        ds_v = h.xarray(RRFS_SEARCH["wind_v"])
                        arrays["wind_speed"] = self.compute_wind_speed(
                            xr.merge([ds_u, ds_v]), "u10", "v10"
                        )
                    elif var in RRFS_SEARCH:
                        ds = h.xarray(RRFS_SEARCH[var])
                        first_var = list(ds.data_vars)[0]
                        arrays[var] = ds[first_var]

                results[fhr] = xr.Dataset(arrays)
                logger.info("RRFS fhr=%d fetched successfully", fhr)
            except Exception:
                logger.exception("RRFS fhr=%d fetch failed", fhr)
            finally:
                del h
                gc.collect()

        return results
