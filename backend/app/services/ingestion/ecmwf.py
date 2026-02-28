import gc
import logging
import tempfile
from datetime import datetime
from pathlib import Path

import xarray as xr

from app.services.ingestion.base import DEFAULT_LEAD_HOURS, ModelFetcher

logger = logging.getLogger(__name__)

# Surface parameters to retrieve from IFS open data.
SURFACE_PARAMS = ["tp", "10u", "10v", "msl"]

# Pressure-level parameter (geopotential height at 500 hPa).
PRESSURE_PARAMS = ["gh"]


class ECMWFFetcher(ModelFetcher):
    """Fetch ECMWF IFS real-time forecast data via the ecmwf-opendata package.

    Uses the free ECMWF Open Data API — no API key required.  IFS runs
    every 6 hours (00/06/12/18 UTC) at 0.25° resolution, with lead hours
    up to 240h for 00/12Z and 90h for 06/18Z.
    """

    name = "ECMWF"

    def fetch(
        self,
        init_time: datetime,
        variables: list[str] | None = None,
        lead_hours: list[int] | None = None,
    ) -> dict[int, xr.Dataset]:
        from ecmwf.opendata import Client

        lead_hours = lead_hours or DEFAULT_LEAD_HOURS
        variables = variables or ["precip", "wind_speed", "mslp", "hgt_500"]
        results: dict[int, xr.Dataset] = {}

        client = Client(source="ecmwf", model="ifs", resol="0p25")

        # Quick availability check: ask the library what the latest cycle is.
        # If our requested cycle isn't published yet, bail out early instead
        # of spamming 404 errors for every lead hour.
        try:
            latest = client.latest(type="fc", step=0)
            latest_naive = latest.replace(tzinfo=None)
            init_naive = init_time.replace(tzinfo=None)
            if latest_naive < init_naive:
                raise RuntimeError(
                    f"ECMWF IFS cycle {init_time} not available yet "
                    f"(latest: {latest}). Will retry next schedule."
                )
            logger.info(
                "ECMWF IFS latest available cycle: %s (requested: %s)",
                latest,
                init_time,
            )
        except RuntimeError:
            raise
        except Exception:
            logger.warning(
                "Could not check ECMWF IFS data availability; "
                "proceeding with requested cycle %s",
                init_time,
            )

        for fhr in lead_hours:
            try:
                arrays: dict[str, xr.DataArray] = {}

                with tempfile.TemporaryDirectory() as tmpdir:
                    # --- Surface variables ---
                    needed_sfc = []
                    if "precip" in variables:
                        needed_sfc.append("tp")
                    if "wind_speed" in variables:
                        needed_sfc.extend(["10u", "10v"])
                    if "mslp" in variables:
                        needed_sfc.append("msl")

                    if needed_sfc:
                        sfc_path = str(Path(tmpdir) / f"sfc_fhr{fhr:03d}.grib2")
                        client.retrieve(
                            date=init_time.strftime("%Y-%m-%d"),
                            time=init_time.hour,
                            type="fc",
                            step=fhr,
                            param=needed_sfc,
                            target=sfc_path,
                        )
                        # cfgrib may split mixed level-types into multiple
                        # datasets; open_datasets + merge handles this.
                        import cfgrib

                        sfc_datasets = cfgrib.open_datasets(sfc_path)
                        sfc_ds = xr.merge(sfc_datasets)

                        if "precip" in variables and "tp" in sfc_ds:
                            arrays["precip"] = sfc_ds["tp"].load()
                        if "wind_speed" in variables:
                            u_var = "u10" if "u10" in sfc_ds else "10u"
                            v_var = "v10" if "v10" in sfc_ds else "10v"
                            if u_var in sfc_ds and v_var in sfc_ds:
                                arrays["wind_speed"] = self.compute_wind_speed(
                                    sfc_ds, u_var, v_var
                                )
                        if "mslp" in variables and "msl" in sfc_ds:
                            arrays["mslp"] = sfc_ds["msl"].load()

                        # Close cfgrib file handles
                        for _d in sfc_datasets:
                            _d.close()
                        sfc_ds.close()
                        del sfc_datasets, sfc_ds

                    # --- Pressure-level variables (500 hPa geopotential height) ---
                    if "hgt_500" in variables:
                        pl_path = str(Path(tmpdir) / f"pl_fhr{fhr:03d}.grib2")
                        client.retrieve(
                            date=init_time.strftime("%Y-%m-%d"),
                            time=init_time.hour,
                            type="fc",
                            step=fhr,
                            param=PRESSURE_PARAMS,
                            levelist=500,
                            target=pl_path,
                        )
                        pl_ds = xr.open_dataset(pl_path, engine="cfgrib")
                        # IFS open data provides "gh" (geopotential height in m),
                        # not "z" (geopotential in m²/s²) like ERA5.
                        gh_var = "gh" if "gh" in pl_ds else "z"
                        if gh_var in pl_ds:
                            da = pl_ds[gh_var]
                            if "isobaricInhPa" in da.dims:
                                da = da.sel(isobaricInhPa=500, drop=True)
                            arrays["hgt_500"] = da.load()
                        pl_ds.close()
                        del pl_ds

                # Build dataset and normalise coordinate names.
                ds = xr.Dataset(arrays)
                if "latitude" not in ds.coords and "lat" in ds.coords:
                    ds = ds.rename({"lat": "latitude", "lon": "longitude"})

                results[fhr] = ds
                logger.info("ECMWF IFS fhr=%d fetched successfully", fhr)

            except Exception:
                logger.exception("ECMWF IFS fhr=%d fetch failed", fhr)
            finally:
                gc.collect()

        return results
