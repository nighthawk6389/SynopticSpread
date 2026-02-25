import logging
from datetime import datetime

import xarray as xr
from herbie import Herbie

from app.services.ingestion.base import DEFAULT_LEAD_HOURS, ModelFetcher

logger = logging.getLogger(__name__)

NAM_SEARCH = {
    "precip": ":APCP:surface:0-",
    "wind_u": ":UGRD:10 m above ground",
    "wind_v": ":VGRD:10 m above ground",
    "mslp": ":PRMSL:mean sea level",
    "hgt_500": ":HGT:500 mb",
}


class NAMFetcher(ModelFetcher):
    name = "NAM"

    def fetch(
        self,
        init_time: datetime,
        variables: list[str] | None = None,
        lead_hours: list[int] | None = None,
    ) -> dict[int, xr.Dataset]:
        lead_hours = lead_hours or DEFAULT_LEAD_HOURS[:13]  # NAM goes to 84h
        variables = variables or ["precip", "wind_speed", "mslp", "hgt_500"]
        results: dict[int, xr.Dataset] = {}

        for fhr in lead_hours:
            try:
                h = Herbie(
                    init_time,
                    model="nam",
                    product="conusnest.hiresf",
                    fxx=fhr,
                )
                arrays: dict[str, xr.DataArray] = {}

                for var in variables:
                    if var == "wind_speed":
                        ds_u = h.xarray(NAM_SEARCH["wind_u"])
                        ds_v = h.xarray(NAM_SEARCH["wind_v"])
                        arrays["wind_speed"] = self.compute_wind_speed(
                            xr.merge([ds_u, ds_v]), "u10", "v10"
                        )
                    elif var in NAM_SEARCH:
                        ds = h.xarray(NAM_SEARCH[var])
                        first_var = list(ds.data_vars)[0]
                        arrays[var] = ds[first_var]

                results[fhr] = xr.Dataset(arrays)
                logger.info("NAM fhr=%d fetched successfully", fhr)
            except Exception:
                logger.exception("NAM fhr=%d fetch failed", fhr)

        return results
