import logging
from datetime import datetime

import xarray as xr
from herbie import Herbie

from app.services.ingestion.base import DEFAULT_LEAD_HOURS, ModelFetcher

logger = logging.getLogger(__name__)

NAM_SEARCH = {
    "precip": ":APCP:surface:",  # NAM uses "3-6 hour acc" format, not "0-X"
    # shared byte range -- must fetch together
    "wind_uv": ":(UGRD|VGRD):10 m above ground",
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
                    init_time.replace(tzinfo=None),
                    model="nam",
                    product="conusnest.hiresf",
                    fxx=fhr,
                )
                arrays: dict[str, xr.DataArray] = {}

                # Fetch U+V together (shared byte range in NAM CONUSNEST)
                if "wind_speed" in variables:
                    ds_uv = h.xarray(NAM_SEARCH["wind_uv"])
                    arrays["wind_speed"] = self.compute_wind_speed(ds_uv, "u10", "v10")

                for var in variables:
                    if var == "wind_speed":
                        continue  # handled above
                    if var in NAM_SEARCH:
                        ds = h.xarray(NAM_SEARCH[var])
                        first_var = list(ds.data_vars)[0]
                        arrays[var] = ds[first_var]

                results[fhr] = xr.Dataset(arrays)
                logger.info("NAM fhr=%d fetched successfully", fhr)
            except Exception:
                logger.exception("NAM fhr=%d fetch failed", fhr)

        return results
