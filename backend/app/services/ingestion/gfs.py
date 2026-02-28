import gc
import logging
from datetime import datetime

import xarray as xr
from herbie import Herbie

from app.services.ingestion.base import DEFAULT_LEAD_HOURS, ModelFetcher

logger = logging.getLogger(__name__)

# GFS GRIB2 search patterns for each canonical variable
GFS_SEARCH = {
    "precip": ":APCP:surface:0-",
    "wind_u": ":UGRD:10 m above ground",
    "wind_v": ":VGRD:10 m above ground",
    "mslp": ":PRMSL:mean sea level",
    "hgt_500": ":HGT:500 mb",
}


class GFSFetcher(ModelFetcher):
    name = "GFS"

    def fetch(
        self,
        init_time: datetime,
        variables: list[str] | None = None,
        lead_hours: list[int] | None = None,
    ) -> dict[int, xr.Dataset]:
        lead_hours = lead_hours or DEFAULT_LEAD_HOURS
        variables = variables or ["precip", "wind_speed", "mslp", "hgt_500"]
        results: dict[int, xr.Dataset] = {}

        for fhr in lead_hours:
            try:
                h = Herbie(
                    init_time.replace(tzinfo=None),
                    model="gfs",
                    product="pgrb2.0p25",
                    fxx=fhr,
                )
                arrays: dict[str, xr.DataArray] = {}

                for var in variables:
                    if var == "wind_speed":
                        ds_u = h.xarray(GFS_SEARCH["wind_u"])
                        ds_v = h.xarray(GFS_SEARCH["wind_v"])
                        arrays["wind_speed"] = self.compute_wind_speed(
                            xr.merge([ds_u, ds_v]), "u10", "v10"
                        )
                    elif var in GFS_SEARCH:
                        ds = h.xarray(GFS_SEARCH[var])
                        first_var = list(ds.data_vars)[0]
                        arrays[var] = ds[first_var]

                results[fhr] = xr.Dataset(arrays)
                logger.info("GFS fhr=%d fetched successfully", fhr)
            except Exception:
                logger.exception("GFS fhr=%d fetch failed", fhr)
            finally:
                # Free Herbie object and intermediate datasets
                del h
                gc.collect()

        return results
