import logging
from datetime import datetime

import xarray as xr
from herbie import Herbie

from app.services.ingestion.base import ModelFetcher

logger = logging.getLogger(__name__)

# RRFS GRIB2 search patterns (pressure-level product)
RRFS_SEARCH = {
    "precip": ":APCP:surface:",
    "wind_u": ":UGRD:10 m above ground",
    "wind_v": ":VGRD:10 m above ground",
    "mslp": ":PRMSL:mean sea level",
    "hgt_500": ":HGT:500 mb",
}

# RRFS extended runs: 0-84h in 6h steps at 00/06/12/18Z
RRFS_LEAD_HOURS = list(range(0, 85, 6))


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
                    product="prs",
                    fxx=fhr,
                    member="control",
                    domain="conus",
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

        return results
