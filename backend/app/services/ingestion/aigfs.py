import gc
import logging
from datetime import datetime

import xarray as xr
from herbie import Herbie

from app.services.ingestion.base import ModelFetcher

logger = logging.getLogger(__name__)

# AIGFS GRIB2 search patterns.
# Surface fields come from product="sfc", pressure-level fields from product="pres".
# AIGFS does NOT produce precipitation (APCP).
AIGFS_SFC_SEARCH = {
    "wind_u": ":UGRD:10 m above ground",
    "wind_v": ":VGRD:10 m above ground",
    "mslp": ":PRMSL:mean sea level",
}

AIGFS_PRES_SEARCH = {
    "hgt_500": ":HGT:500 mb",
}

# AIGFS runs at 00Z and 12Z only; 16-day forecasts in 6h steps
AIGFS_LEAD_HOURS = list(range(0, 385, 6))


class AIGFSFetcher(ModelFetcher):
    name = "AIGFS"

    def fetch(
        self,
        init_time: datetime,
        variables: list[str] | None = None,
        lead_hours: list[int] | None = None,
    ) -> dict[int, xr.Dataset]:
        lead_hours = lead_hours or AIGFS_LEAD_HOURS
        variables = variables or ["wind_speed", "mslp", "hgt_500"]
        results: dict[int, xr.Dataset] = {}

        # AIGFS has no precipitation — warn and filter it out
        if "precip" in variables:
            logger.warning("AIGFS does not produce precipitation; skipping precip")
            variables = [v for v in variables if v != "precip"]

        need_pres = any(v in AIGFS_PRES_SEARCH for v in variables)

        for fhr in lead_hours:
            try:
                h_sfc = Herbie(
                    init_time.replace(tzinfo=None),
                    model="aigfs",
                    product="sfc",
                    fxx=fhr,
                )
                arrays: dict[str, xr.DataArray] = {}

                for var in variables:
                    if var == "wind_speed":
                        ds_u = h_sfc.xarray(AIGFS_SFC_SEARCH["wind_u"])
                        ds_v = h_sfc.xarray(AIGFS_SFC_SEARCH["wind_v"])
                        arrays["wind_speed"] = self.compute_wind_speed(
                            xr.merge([ds_u, ds_v]), "u10", "v10"
                        )
                    elif var in AIGFS_SFC_SEARCH:
                        ds = h_sfc.xarray(AIGFS_SFC_SEARCH[var])
                        first_var = list(ds.data_vars)[0]
                        arrays[var] = ds[first_var]

                # Fetch pressure-level fields separately
                if need_pres:
                    h_pres = Herbie(
                        init_time.replace(tzinfo=None),
                        model="aigfs",
                        product="pres",
                        fxx=fhr,
                    )
                    for var in variables:
                        if var in AIGFS_PRES_SEARCH:
                            ds = h_pres.xarray(AIGFS_PRES_SEARCH[var])
                            first_var = list(ds.data_vars)[0]
                            arrays[var] = ds[first_var]

                results[fhr] = xr.Dataset(arrays)
                logger.info("AIGFS fhr=%d fetched successfully", fhr)
            except Exception:
                logger.exception("AIGFS fhr=%d fetch failed", fhr)
            finally:
                # Free Herbie objects (h_sfc, h_pres may not exist on failure)
                for _name in ("h_sfc", "h_pres"):
                    locals().pop(_name, None)
                gc.collect()

        return results
