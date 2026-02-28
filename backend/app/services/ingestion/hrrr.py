import gc
import logging
from datetime import datetime

import xarray as xr
from herbie import Herbie

from app.services.ingestion.base import ModelFetcher

logger = logging.getLogger(__name__)

# HRRR GRIB2 search patterns for each canonical variable
HRRR_SEARCH = {
    "precip": ":APCP:surface:0-",
    "wind_u": ":UGRD:10 m above ground",
    "wind_v": ":VGRD:10 m above ground",
    "mslp": ":MSLMA:mean sea level",
    "hgt_500": ":HGT:500 mb",
}

# HRRR lead hours: 0–48h in 6h steps (matching GFS pattern)
HRRR_LEAD_HOURS = list(range(0, 49, 6))


class HRRRFetcher(ModelFetcher):
    name = "HRRR"

    def fetch(
        self,
        init_time: datetime,
        variables: list[str] | None = None,
        lead_hours: list[int] | None = None,
    ) -> dict[int, xr.Dataset]:
        lead_hours = lead_hours or HRRR_LEAD_HOURS
        variables = variables or ["precip", "wind_speed", "mslp", "hgt_500"]
        results: dict[int, xr.Dataset] = {}

        for fhr in lead_hours:
            try:
                h = Herbie(
                    init_time.replace(tzinfo=None),
                    model="hrrr",
                    product="sfc",
                    fxx=fhr,
                )
                arrays: dict[str, xr.DataArray] = {}

                for var in variables:
                    if var == "wind_speed":
                        ds_u = h.xarray(HRRR_SEARCH["wind_u"])
                        ds_v = h.xarray(HRRR_SEARCH["wind_v"])
                        arrays["wind_speed"] = self.compute_wind_speed(
                            xr.merge([ds_u, ds_v]), "u10", "v10"
                        )
                    elif var == "mslp":
                        ds = h.xarray(HRRR_SEARCH["mslp"])
                        first_var = list(ds.data_vars)[0]
                        arrays[var] = ds[first_var]
                    elif var in HRRR_SEARCH:
                        ds = h.xarray(HRRR_SEARCH[var])
                        first_var = list(ds.data_vars)[0]
                        arrays[var] = ds[first_var]

                results[fhr] = xr.Dataset(arrays)
                logger.info("HRRR fhr=%d fetched successfully", fhr)
            except Exception:
                logger.exception("HRRR fhr=%d fetch failed", fhr)
            finally:
                del h
                gc.collect()

        return results
