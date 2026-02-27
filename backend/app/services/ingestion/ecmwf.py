import logging
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import xarray as xr

from app.services.ingestion.base import DEFAULT_LEAD_HOURS, ModelFetcher

logger = logging.getLogger(__name__)

# ERA5T (preliminary) data is available ~5 days behind real time on the CDS.
ERA5_DELAY_DAYS = 5

# CDS variable names for each canonical variable
CDS_VARIABLES = {
    "precip": "total_precipitation",
    "wind_u": "10m_u_component_of_wind",
    "wind_v": "10m_v_component_of_wind",
    "mslp": "mean_sea_level_pressure",
    "hgt_500": "geopotential",
}


def latest_era5_cycle() -> datetime:
    """Return the most recent ERA5 analysis time likely available on the CDS.

    ERA5T preliminary data is published ~5 days behind real time, so we
    target the 00Z cycle from 5 days ago.
    """
    now = datetime.now(timezone.utc)
    return (now - timedelta(days=ERA5_DELAY_DAYS)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )


class ECMWFFetcher(ModelFetcher):
    name = "ECMWF"

    def __init__(self):
        from app.config import settings

        try:
            import cdsapi

            if settings.ecmwf_api_key:
                self.client = cdsapi.Client(
                    url=settings.ecmwf_api_url,
                    key=settings.ecmwf_api_key,
                )
            else:
                # Fall back to ~/.cdsapirc
                self.client = cdsapi.Client()
        except Exception:
            logger.warning(
                "cdsapi not configured — ECMWF fetcher will not work. "
                "Set ECMWF_API_KEY in .env or set up ~/.cdsapirc."
            )
            self.client = None

    def fetch(
        self,
        init_time: datetime,
        variables: list[str] | None = None,
        lead_hours: list[int] | None = None,
    ) -> dict[int, xr.Dataset]:
        if self.client is None:
            logger.error("ECMWF client not available")
            return {}

        lead_hours = lead_hours or DEFAULT_LEAD_HOURS
        variables = variables or ["precip", "wind_speed", "mslp", "hgt_500"]
        results: dict[int, xr.Dataset] = {}

        # Build CDS variable list
        cds_vars = []
        for var in variables:
            if var == "wind_speed":
                cds_vars.extend([CDS_VARIABLES["wind_u"], CDS_VARIABLES["wind_v"]])
            elif var in CDS_VARIABLES:
                cds_vars.append(CDS_VARIABLES[var])

        # Determine pressure levels needed
        pressure_levels = []
        if "hgt_500" in variables:
            pressure_levels.append("500")

        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                # Single-level variables
                single_vars = [v for v in cds_vars if v != "geopotential"]
                if single_vars:
                    sl_path = Path(tmpdir) / "single_level.grib"
                    self.client.retrieve(
                        "reanalysis-era5-single-levels",
                        {
                            "product_type": "reanalysis",
                            "variable": single_vars,
                            "year": str(init_time.year),
                            "month": f"{init_time.month:02d}",
                            "day": f"{init_time.day:02d}",
                            "time": f"{init_time.hour:02d}:00",
                            "format": "grib",
                        },
                        str(sl_path),
                    )
                    sl_ds = xr.open_dataset(sl_path, engine="cfgrib")

                # Pressure-level variables
                pl_ds = None
                if pressure_levels:
                    pl_path = Path(tmpdir) / "pressure_level.grib"
                    self.client.retrieve(
                        "reanalysis-era5-pressure-levels",
                        {
                            "product_type": "reanalysis",
                            "variable": ["geopotential"],
                            "pressure_level": pressure_levels,
                            "year": str(init_time.year),
                            "month": f"{init_time.month:02d}",
                            "day": f"{init_time.day:02d}",
                            "time": f"{init_time.hour:02d}:00",
                            "format": "grib",
                        },
                        str(pl_path),
                    )
                    pl_ds = xr.open_dataset(pl_path, engine="cfgrib")

                # Map to canonical names for lead_hour=0 (ERA5 is analysis)
                arrays: dict[str, xr.DataArray] = {}
                for var in variables:
                    if var == "precip" and "tp" in sl_ds:
                        arrays["precip"] = sl_ds["tp"]
                    elif var == "wind_speed" and "u10" in sl_ds and "v10" in sl_ds:
                        arrays["wind_speed"] = self.compute_wind_speed(
                            sl_ds, "u10", "v10"
                        )
                    elif var == "mslp" and "msl" in sl_ds:
                        arrays["mslp"] = sl_ds["msl"]
                    elif var == "hgt_500" and pl_ds is not None and "z" in pl_ds:
                        arrays["hgt_500"] = pl_ds["z"].sel(isobaricInhPa=500, drop=True)

                results[0] = xr.Dataset(arrays)
                logger.info("ECMWF analysis fetched successfully")

        except Exception:
            logger.exception("ECMWF fetch failed")

        return results
