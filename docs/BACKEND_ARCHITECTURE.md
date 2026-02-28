# Backend Architecture & Implementation

This document describes the technical implementation of the SynopticSpread backend: an async Python service that ingests numerical weather prediction (NWP) model data from external sources, computes cross-model divergence metrics, stores results in PostgreSQL and on-disk Zarr files, and exposes the data through a REST API.

---

## Table of Contents

1. [Technology Stack](#1-technology-stack)
2. [Package Layout](#2-package-layout)
3. [Application Bootstrap & Lifespan](#3-application-bootstrap--lifespan)
4. [Configuration](#4-configuration)
5. [Database Layer](#5-database-layer)
6. [Storage Schema](#6-storage-schema)
7. [Data Ingestion — External Calls](#7-data-ingestion--external-calls)
8. [Data Transformations & Metric Computation](#8-data-transformations--metric-computation)
9. [Grid Divergence & Zarr Storage](#9-grid-divergence--zarr-storage)
10. [Scheduler](#10-scheduler)
11. [REST API Endpoints](#11-rest-api-endpoints)
12. [Pydantic Response Schemas](#12-pydantic-response-schemas)
13. [Admin CLI](#13-admin-cli)
14. [Testing Strategy](#14-testing-strategy)
15. [Database Migrations](#15-database-migrations)
16. [Docker & Deployment](#16-docker--deployment)
17. [Dependency Inventory](#17-dependency-inventory)

---

## 1. Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| Web framework | FastAPI 0.115+ | Async REST API with automatic OpenAPI docs |
| ASGI server | Uvicorn 0.32+ | High-performance async server |
| ORM | SQLAlchemy 2.0+ (async) | Async database access via `asyncpg` driver |
| Database | PostgreSQL 16 | Primary relational store (model runs, metrics, snapshot metadata) |
| Migrations | Alembic 1.14+ | Schema versioning and migration management |
| Config | pydantic-settings 2.6+ | Type-safe settings with `.env` file support |
| Scheduling | APScheduler 3.11+ | Cron-based periodic ingestion jobs |
| Weather data | herbie-data 2024.9+ | GRIB2 fetching from NOAA NOMADS (GFS, NAM) |
| Weather data | ecmwf-opendata 0.3+ | ECMWF IFS real-time forecast access (no API key) |
| Scientific | xarray, numpy, pandas, scipy | Multi-dimensional array operations, interpolation |
| GRIB2 decoding | cfgrib 0.9+ | GRIB2-to-xarray via eccodes C library |
| Array storage | zarr 2.18+ | Chunked, compressed on-disk array storage |
| Build system | Hatchling | PEP 517 build backend |
| Linting | Ruff 0.8+ | Fast Python linter and formatter |
| Testing | pytest 8.3+, pytest-asyncio | Async test runner |

---

## 2. Package Layout

```
backend/
├── pyproject.toml                  # Build metadata, dependencies, tool config
├── alembic.ini                     # Alembic migration config
├── alembic/
│   ├── env.py                      # Async migration runner
│   └── versions/
│       └── 39a5ab22268c_initial.py # Initial schema migration
├── app/
│   ├── main.py                     # FastAPI app, CORS, lifespan
│   ├── config.py                   # pydantic-settings (reads .env)
│   ├── database.py                 # SQLAlchemy async engine + session factory
│   ├── models/
│   │   ├── __init__.py             # Re-exports: ModelRun, PointMetric, GridSnapshot, RunStatus
│   │   ├── model_run.py            # ModelRun ORM model, RunStatus enum
│   │   └── divergence.py           # PointMetric, GridSnapshot ORM models
│   ├── schemas/
│   │   ├── forecast.py             # ModelRunOut, ForecastPointRequest
│   │   └── divergence.py           # PointMetricOut, GridSnapshotOut, GridDivergenceData, DivergenceSummary
│   ├── routers/
│   │   ├── forecasts.py            # GET /api/variables, GET /api/runs
│   │   ├── divergence.py           # GET /api/divergence/{point,grid,grid/snapshots,summary}
│   │   └── admin.py                # GET /api/admin/status, POST /trigger, DELETE endpoints
│   └── services/
│       ├── ingestion/
│       │   ├── base.py             # ModelFetcher ABC, VARIABLES dict, DEFAULT_LEAD_HOURS
│       │   ├── gfs.py              # GFSFetcher (herbie-data)
│       │   ├── nam.py              # NAMFetcher (herbie-data)
│       │   └── ecmwf.py            # ECMWFFetcher (ecmwf-opendata)
│       ├── processing/
│       │   ├── metrics.py          # extract_point, compute_pairwise_metrics, compute_ensemble_spread
│       │   └── grid.py             # regrid_to_common, compute_grid_divergence, save/load Zarr
│       └── scheduler.py            # APScheduler cron jobs wiring ingestion + processing
└── tests/
    ├── conftest.py                 # Fixtures: in-memory SQLite DB, ARRAY→JSON patch, AsyncClient
    ├── test_api.py                 # Smoke tests (health, variables)
    ├── test_metrics.py             # Unit tests for point-level metrics
    ├── test_grid.py                # Unit tests for grid divergence computation
    ├── test_grid_zarr.py           # Zarr round-trip + edge case tests
    ├── test_ingestion.py           # Fetcher unit tests (herbie/ecmwf-opendata mocked)
    ├── test_routers.py             # Router unit tests (DB fully mocked)
    ├── test_integration.py         # Full-stack integration tests (real SQLite + HTTP)
    └── test_scheduler.py           # Scheduler logic unit tests
```

---

## 3. Application Bootstrap & Lifespan

**File:** `app/main.py`

The FastAPI app uses an `asynccontextmanager` lifespan that manages two critical subsystems:

```
Startup:
  1. Create DATA_STORE_PATH directory (mkdir -p)
  2. If DATABASE_AUTO_CREATE=true:
       → Import engine, run Base.metadata.create_all synchronously within an async connection
       → This bypasses Alembic for simple deployments (e.g., Render first boot)
  3. If SCHEDULER_ENABLED=true:
       → Import the APScheduler instance and call scheduler.start()

Shutdown:
  4. If scheduler was started:
       → scheduler.shutdown(wait=False)
```

**CORS middleware** is configured from `settings.allowed_origins` (defaults to `["http://localhost:5173"]`), allowing all methods and headers with credentials.

**Router mounting:** Three routers are mounted under the `/api` prefix:
- `forecasts.router` — model run and variable queries
- `divergence.router` — divergence data endpoints (further prefixed to `/api/divergence`)
- `admin.router` — administrative operations (further prefixed to `/api/admin`)

**Health endpoint:** `GET /api/health` returns `{"status": "ok"}`.

**Frontend serving:** At module load time, FastAPI checks for a `frontend_dist/` directory adjacent to the `app/` package. If present (in production Docker builds), it mounts a `StaticFiles` handler at `/` with `html=True`, serving the compiled SPA and enabling client-side routing fallback.

---

## 4. Configuration

**File:** `app/config.py`

Settings are managed by a `pydantic_settings.BaseSettings` subclass that reads from environment variables and a `.env` file:

| Setting | Type | Default | Description |
|---|---|---|---|
| `database_url` | `str` | `postgresql+asyncpg://synoptic:synoptic@localhost:5432/synopticspread` | Async SQLAlchemy connection URL |
| *(removed)* | | | ECMWF no longer requires API keys — uses free open data |
| `data_store_path` | `Path` | `./data` | Root directory for Zarr files and GRIB cache |
| `scheduler_enabled` | `bool` | `true` | Enables APScheduler cron jobs |
| `database_auto_create` | `bool` | `false` | Creates ORM tables on startup (bypasses Alembic) |
| `allowed_origins` | `list[str]` | `["http://localhost:5173"]` | CORS allowed origins |
| `monitor_points` | `list[tuple[float, float, str]]` | 8 US cities | Predefined points for pairwise metric computation |

The **monitor points** are hardcoded coordinates for 8 major US cities:
- New York (40.7128, -74.006), Los Angeles (34.0522, -118.2437), Chicago (41.8781, -87.6298), Houston (29.7604, -95.3698), Seattle (47.6062, -122.3321), Denver (39.7392, -104.9903), Miami (25.7617, -80.1918), Washington DC (38.9072, -77.0369)

---

## 5. Database Layer

**File:** `app/database.py`

The database layer uses SQLAlchemy 2.0 async support:

```python
engine = create_async_engine(settings.database_url, echo=False)
async_session = async_sessionmaker(engine, expire_on_commit=False)
```

- **Engine**: `create_async_engine` with the `asyncpg` driver (for PostgreSQL)
- **Session factory**: `async_sessionmaker` with `expire_on_commit=False` to avoid lazy-load issues in async context
- **Base class**: `DeclarativeBase` subclass used by all ORM models
- **Dependency injection**: `get_db()` is an async generator that yields a session from the factory, used as a FastAPI `Depends()` parameter

---

## 6. Storage Schema

### 6.1 PostgreSQL Tables

The database has three tables, defined as SQLAlchemy ORM models and formalized in the Alembic initial migration (`39a5ab22268c`).

#### `model_runs`

Tracks each ingestion attempt for a model initialization cycle.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | PK, auto-generated `uuid4` | Unique run identifier |
| `model_name` | `String(16)` | Indexed | NWP model name (GFS, NAM, ECMWF) |
| `init_time` | `DateTime(timezone=True)` | Indexed | Model initialization time |
| `forecast_hours` | `ARRAY(INTEGER)` | Not null | List of lead hours fetched (e.g., [0, 6, 12, ..., 120]) |
| `status` | `Enum(RunStatus)` | Default: `pending` | Lifecycle state: `pending` → `complete` or `error` |
| `created_at` | `DateTime(timezone=True)` | Server default: `now()` | Row creation timestamp |

**Indexes:** `ix_model_runs_model_name`, `ix_model_runs_init_time`

#### `point_metrics`

Stores pairwise divergence measurements at specific geographic coordinates.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | PK, auto-generated `uuid4` | Unique metric identifier |
| `run_a_id` | `UUID` | FK → `model_runs.id`, Indexed | First model's run ID |
| `run_b_id` | `UUID` | FK → `model_runs.id`, Indexed | Second model's run ID |
| `variable` | `String(32)` | Indexed | Canonical variable name |
| `lat` | `Float` | Not null | Latitude of measurement point |
| `lon` | `Float` | Not null | Longitude of measurement point |
| `lead_hour` | `Integer` | Indexed | Forecast lead time in hours |
| `rmse` | `Float` | Not null | Absolute difference between models at this point |
| `bias` | `Float` | Not null | Signed difference (model_a - model_b) |
| `spread` | `Float` | Not null | Std deviation across all models at this point |
| `created_at` | `DateTime(timezone=True)` | Server default: `now()` | Row creation timestamp |

**Indexes:** `ix_point_metrics_run_a_id`, `ix_point_metrics_run_b_id`, `ix_point_metrics_variable`, `ix_point_metrics_lead_hour`

**Foreign keys:** Both `run_a_id` and `run_b_id` reference `model_runs.id`.

#### `grid_snapshots`

Metadata records pointing to on-disk Zarr files containing grid divergence arrays.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | PK, auto-generated `uuid4` | Unique snapshot identifier |
| `init_time` | `DateTime(timezone=True)` | Indexed | Model initialization time |
| `variable` | `String(32)` | Indexed | Canonical variable name |
| `lead_hour` | `Integer` | Not null | Forecast lead hour |
| `zarr_path` | `String(512)` | Not null | Filesystem path to `.zarr` directory |
| `bbox` | `JSON` | Not null | Bounding box: `{min_lat, max_lat, min_lon, max_lon}` |
| `created_at` | `DateTime(timezone=True)` | Server default: `now()` | Row creation timestamp |

**Indexes:** `ix_grid_snapshots_init_time`, `ix_grid_snapshots_variable`

### 6.2 On-Disk Zarr Storage

Grid divergence arrays are saved as Zarr stores on the filesystem under `DATA_STORE_PATH`:

```
data/
└── divergence/
    └── {init_time_str}/          # e.g., "2026022600"
        └── {variable}/           # e.g., "precip"
            └── fhr{NNN}.zarr/    # e.g., "fhr024.zarr" (3-digit zero-padded)
```

Each `.zarr` directory is a self-contained xarray Dataset with:
- **Coordinates:** `latitude` (1D float array), `longitude` (1D float array)
- **Data variable:** `{variable}_divergence` — 2D float array `[latitude, longitude]` containing per-grid-cell standard deviation across models
- **Grid resolution:** 0.25° (matching the common regridding target)

---

## 7. Data Ingestion — External Calls

### 7.1 Fetcher Architecture

All fetchers inherit from the `ModelFetcher` abstract base class:

```python
class ModelFetcher(ABC):
    name: str  # "GFS", "NAM", "ECMWF"

    @abstractmethod
    def fetch(self, init_time, variables, lead_hours) -> dict[int, xr.Dataset]: ...

    @staticmethod
    def compute_wind_speed(ds, u_var, v_var) -> xr.DataArray:
        return sqrt(ds[u_var]² + ds[v_var]²)
```

**Contract:** All fetchers return `dict[int, xr.Dataset]` where:
- Keys are integer lead hours (0, 6, 12, ..., 120)
- Each Dataset uses `latitude`/`longitude` as coordinate names
- Variables use canonical names: `precip`, `wind_speed`, `mslp`, `hgt_500`

**Canonical variables** defined in `VARIABLES`:
| Name | Description |
|---|---|
| `precip` | Total precipitation |
| `wind_speed` | 10m wind speed (computed from U/V components) |
| `mslp` | Mean sea-level pressure |
| `hgt_500` | 500mb geopotential height |

**Default lead hours:** 0 to 120 inclusive, in 6-hour steps (21 time steps).

### 7.2 GFSFetcher — NOAA GFS via Herbie

**File:** `app/services/ingestion/gfs.py`

**External dependency:** `herbie-data` library, which downloads GRIB2 subsets from NOAA NOMADS HTTP servers.

**GRIB2 search patterns:**
| Variable | Herbie Search String | GRIB2 Field |
|---|---|---|
| `precip` | `:APCP:surface:0-` | Accumulated precipitation |
| `wind_u` | `:UGRD:10 m above ground` | 10m U-component of wind |
| `wind_v` | `:VGRD:10 m above ground` | 10m V-component of wind |
| `mslp` | `:PRMSL:mean sea level` | Pressure reduced to MSL |
| `hgt_500` | `:HGT:500 mb` | Geopotential height at 500 hPa |

**Fetch procedure (per lead hour):**
1. Create a `Herbie` instance with `model="gfs"`, `product="pgrb2.0p25"`, `fxx=lead_hour`
   - The `init_time` has `tzinfo` stripped (`init_time.replace(tzinfo=None)`) because Herbie requires timezone-naive datetimes
2. For each requested variable:
   - **Wind speed:** Fetch U and V GRIB2 messages separately, merge into one Dataset, compute `sqrt(u10² + v10²)`
   - **Other variables:** Fetch the GRIB2 message matching the search pattern, extract the first data variable
3. Combine all variable DataArrays into a single `xr.Dataset`
4. On failure for any lead hour, log the exception and skip (partial results are returned)

**Grid characteristics:** GFS pgrb2.0p25 uses a regular 0.25° lat/lon grid with 1D `latitude` and `longitude` coordinate arrays.

### 7.3 NAMFetcher — NOAA NAM CONUSNEST via Herbie

**File:** `app/services/ingestion/nam.py`

**GRIB2 search patterns:**
| Variable | Herbie Search String | Notes |
|---|---|---|
| `precip` | `:APCP:surface:` | NAM uses "3-6 hour acc" format |
| `wind_uv` | `:(UGRD\|VGRD):10 m above ground` | U and V share a byte range; fetched together |
| `mslp` | `:PRMSL:mean sea level` | Same as GFS |
| `hgt_500` | `:HGT:500 mb` | Same as GFS |

**Key differences from GFS:**
- Model: `"nam"`, product: `"conusnest.hiresf"`
- **Fewer lead hours:** Defaults to first 13 of DEFAULT_LEAD_HOURS (0-72h) since NAM goes to 84h max
- **Wind handling:** U and V components share a GRIB2 byte range in NAM CONUSNEST, so they're fetched together in a single `h.xarray()` call using a regex pattern
- **Grid projection:** NAM CONUSNEST uses Lambert Conformal Conic projection with 2D `(y, x)` auxiliary `latitude`/`longitude` coordinates (not regular 1D arrays). This requires special handling in downstream point extraction and regridding.

### 7.4 ECMWFFetcher — ECMWF IFS Open Data (Real-Time Forecasts)

**File:** `app/services/ingestion/ecmwf.py`

**External dependency:** `ecmwf-opendata` library, accessing ECMWF's free Open Data API.

**CDS variable mapping:**
| Canonical | IFS Open Data Param | Product Type |
|---|---|---|
| `precip` | `tp` | Surface |
| `wind_u` | `10u` | Surface |
| `wind_v` | `10v` | Surface |
| `mslp` | `msl` | Surface |
| `hgt_500` | `gh` (levelist=500) | Pressure-level (500 hPa) |

**Fetch procedure:**
1. **Per-lead-hour:** Like GFS/NAM/HRRR, fetches each lead hour (0-120h, every 6h) independently. No API key required.
2. **Surface variables:** Issues `client.retrieve(type="fc", step=fhr, param=["tp","10u","10v","msl"])` to download surface fields. Opened with `cfgrib.open_datasets()` (handles mixed level types) then merged.
3. **Pressure-level variables:** If `hgt_500` is requested, issues a separate `client.retrieve(param="gh", levelist=500)` call for geopotential height at 500 hPa.
4. **Variable mapping:** cfgrib names (`tp`, `u10`/`v10`, `msl`, `gh`) are mapped to canonical names. Wind speed is computed from components. IFS provides `gh` directly as geopotential height in meters (unlike ERA5 which used `z` in m²/s²).
5. **Grid type:** IFS uses a regular 0.25° lat/lon grid, same as GFS — no Lambert Conformal handling needed.

**Temporary file handling:** All GRIB files are downloaded to a `tempfile.TemporaryDirectory()` that is automatically cleaned up after processing.

---

## 8. Data Transformations & Metric Computation

**File:** `app/services/processing/metrics.py`

### 8.1 Point Extraction

`extract_point(ds, variable, lat, lon) -> float`

Extracts a scalar value at the nearest grid point to the given coordinates. Handles two grid types:

- **1D regular grid (GFS, ECMWF):** Uses xarray's `.sel(latitude=lat, longitude=lon, method="nearest")` for fast indexed lookup.
- **2D projected grid (NAM CONUSNEST):** Computes squared Euclidean distance across the entire 2D `latitude`/`longitude` coordinate arrays, then uses `.argmin(...)` to find the indices of the nearest cell, followed by `.isel(**idx)`.

The dimensionality check is `lat_coord.ndim == 1` vs. `lat_coord.ndim == 2`.

### 8.2 Pairwise Metrics

`compute_pairwise_metrics(datasets, variable, lat, lon) -> list[dict]`

Computes pairwise comparison metrics between all model pairs at a single geographic point:

1. Extracts scalar values for each model at the given point
2. Iterates over all unique pairs (N models → N*(N-1)/2 pairs)
3. For each pair (A, B):
   - **RMSE** = `abs(val_a - val_b)` (single-point RMSE equals absolute difference)
   - **Bias** = `val_a - val_b` (signed difference)
4. Returns list of dicts: `{model_a, model_b, rmse, bias, val_a, val_b}`

### 8.3 Ensemble Spread

`compute_ensemble_spread(datasets, variable, lat, lon) -> float`

Computes the sample standard deviation (`ddof=1`) across all model values at a point:

1. Extracts scalar values from each model that contains the variable
2. If fewer than 2 values, returns `0.0`
3. Otherwise returns `np.std(values, ddof=1)` — the unbiased sample standard deviation

---

## 9. Grid Divergence & Zarr Storage

**File:** `app/services/processing/grid.py`

### 9.1 Regridding

`regrid_to_common(datasets, variable, resolution=0.25) -> dict[str, xr.DataArray]`

Regrids all model fields to a common 0.25° lat/lon grid for cell-by-cell comparison:

1. **Bounding box computation:** Iterates over all datasets, collects min/max lat/lon. The common grid uses the **intersection** of all bounding boxes (max of mins, min of maxes).
2. **Common grid construction:** `np.arange(lat_min, lat_max, resolution)` for both axes.
3. **Per-model regridding** via `_to_regular_grid()`:
   - **1D grids (GFS):** Uses `da.interp(latitude=..., longitude=..., method="nearest")` — xarray's built-in nearest-neighbor interpolation.
   - **2D projected grids (NAM):** Flattens the 2D lat/lon and data arrays, removes NaN values, then uses `scipy.interpolate.griddata(..., method="nearest")` to interpolate onto the regular grid. This constructs a new DataArray with regular 1D coordinates.

### 9.2 Grid Divergence Computation

`compute_grid_divergence(datasets, variable, resolution=0.25) -> xr.DataArray`

1. Calls `regrid_to_common()` to get all models on the same grid
2. Requires at least 2 models (raises `ValueError` otherwise)
3. Stacks all regridded DataArrays along a new `"model"` dimension using `xr.concat(..., dim="model")`
4. Computes per-cell standard deviation: `stacked.std(dim="model", ddof=1)`
5. Names the result `"{variable}_divergence"`

The result is a 2D DataArray of shape `(latitude, longitude)` where each cell holds the cross-model standard deviation.

### 9.3 Zarr Persistence

**Save:** `save_divergence_zarr(divergence, store_path, init_time_str, variable, lead_hour) -> str`
- Creates directory tree: `{store_path}/divergence/{init_time_str}/{variable}/`
- Writes to: `fhr{lead_hour:03d}.zarr` (3-digit zero-padded)
- Uses `da.to_dataset().to_zarr(path, mode="w")` (overwrite mode)
- Returns the Zarr path as a string

**Load:** `load_divergence_zarr(zarr_path) -> xr.DataArray`
- Opens with `xr.open_zarr(path)`
- Extracts the first (and only) data variable from the Dataset

---

## 10. Scheduler

**File:** `app/services/scheduler.py`

### 10.1 APScheduler Configuration

An `AsyncIOScheduler` is instantiated at module level. Three cron jobs are registered:

| Job ID | Model | Schedule (UTC) | Args |
|---|---|---|---|
| `ingest_gfs` | GFS | 01:30, 07:30, 13:30, 19:30 | `["GFS"]` |
| `ingest_nam` | NAM | 01:45, 07:45, 13:45, 19:45 | `["NAM"]` |
| `ingest_ecmwf` | ECMWF | 05:00, 11:00, 17:00, 23:00 | `["ECMWF"]` |

All models run every 6 hours, offset ~5 hours after model initialization (00/06/12/18Z) to allow data to become available. Models are staggered 15 minutes apart to avoid concurrent heavy downloads.

### 10.2 `ingest_and_process(model_name, init_time=None)`

This is the core orchestration function called by both the scheduler and admin trigger endpoint.

**Flow:**

```
1. Determine init_time
   └─ If not provided, compute latest 6-hour cycle boundary (floor UTC hour to nearest 6)

2. Idempotency check
   └─ Query model_runs for existing (model_name, init_time)
   └─ If found → return early (skip duplicate ingestion)

3. Create pending ModelRun record
   └─ INSERT model_runs (status=pending, forecast_hours=[])
   └─ COMMIT

4. Fetch primary model data
   └─ Instantiate the appropriate fetcher class
   └─ Call fetcher.fetch(init_time) → dict[lead_hour, xr.Dataset]
   └─ Update run.forecast_hours = sorted(data.keys())

5. Fetch comparison models (cross-model divergence)
   └─ For each OTHER model:
       └─ Check if a complete run exists for same init_time
       └─ If yes → re-fetch that model's data for comparison

6. Compute divergence (if ≥2 models available)
   └─ Find common lead hours across all models
   └─ For each common lead hour:
       └─ For each variable (precip, wind_speed, mslp, hgt_500):
           ├─ Point metrics: For each monitor_point:
           │   ├─ compute_pairwise_metrics() → RMSE + bias per model pair
           │   ├─ compute_ensemble_spread() → std dev across models
           │   └─ INSERT point_metrics rows (one per pair)
           └─ Grid divergence:
               ├─ compute_grid_divergence() → 2D std-dev array
               ├─ save_divergence_zarr() → write .zarr file
               └─ INSERT grid_snapshots row with zarr_path and bbox

7. Finalize
   └─ Set run.status = complete
   └─ COMMIT

Exception handling:
   └─ If any exception during steps 4-6:
       └─ Set run.status = error
       └─ COMMIT
       └─ Log the full traceback
```

**Key design decisions:**
- **Idempotent:** Checks for existing runs before fetching, preventing duplicate work
- **Partial failure tolerance:** Individual variable/lead_hour failures are caught and logged without aborting the entire run
- **Re-fetch for comparison:** Currently re-downloads other models for comparison rather than caching. This is noted as a future optimization opportunity.

---

## 11. REST API Endpoints

### 11.1 Forecast Endpoints (`routers/forecasts.py`)

**`GET /api/variables`**
- Returns the `VARIABLES` dictionary mapping canonical names to descriptions
- Response: `{"precip": "Total precipitation", "wind_speed": "10m wind speed", ...}`

**`GET /api/runs`**
- Query params: `model_name` (optional, auto-uppercased), `since` (optional datetime), `limit` (default 20, max 100)
- Returns: `list[ModelRunOut]` ordered by `init_time` DESC
- SQL: `SELECT * FROM model_runs [WHERE ...] ORDER BY init_time DESC LIMIT N`

### 11.2 Divergence Endpoints (`routers/divergence.py`)

**`GET /api/divergence/point`**
- Query params: `lat` (required), `lon` (required), `variable` (required), `lead_hour` (optional), `limit` (default 50, max 200)
- **Proximity filter:** Matches points within ±0.5° of requested lat/lon using `BETWEEN` clauses
- Returns: `list[PointMetricOut]` ordered by `created_at` DESC

**`GET /api/divergence/grid`**
- Query params: `variable` (required), `lead_hour` (default 0), `init_time` (optional)
- Fetches the most recent `GridSnapshot` matching criteria
- Loads the Zarr file from disk via `load_divergence_zarr()`
- Returns: `GridDivergenceData` with full 2D array as nested list
- Returns 404 if no matching snapshot exists

**`GET /api/divergence/grid/snapshots`**
- Query params: `variable` (optional), `limit` (default 20, max 100)
- Returns: `list[GridSnapshotOut]` ordered by `init_time` DESC

**`GET /api/divergence/summary`**
- No params
- Iterates over the 4 canonical variables, computing SQL aggregates per variable:
  - `AVG(spread)` → `mean_spread`
  - `MAX(spread)` → `max_spread`
  - `COUNT(id)` → `num_points`
- Omits variables with 0 data points
- Hardcodes `models_compared: ["GFS", "NAM", "ECMWF", "HRRR"]`
- Returns: `list[DivergenceSummary]`

### 11.3 Admin Endpoints (`routers/admin.py`)

**`GET /api/admin/status`**
- Counts: model runs, point metrics, grid snapshots, Zarr files on disk
- Lists 10 most recent runs
- Uses its own `async_session()` (not dependency-injected)

**`POST /api/admin/trigger`**
- Body: `{"model": "GFS", "init_time": "2026-02-25T18:00:00"}` (init_time optional)
- Validates model name against `{"GFS", "NAM", "ECMWF", "HRRR"}`
- Defaults to latest 6-hour cycle if init_time omitted
- Runs ingestion as a FastAPI `BackgroundTask` (non-blocking)
- Returns: `TriggerResponse` with status "queued"

**`DELETE /api/admin/runs`** — Deletes all `model_runs` rows
**`DELETE /api/admin/metrics`** — Deletes all `point_metrics` rows
**`DELETE /api/admin/snapshots`** — Deletes all `grid_snapshots` rows + removes `divergence/` directory tree
**`DELETE /api/admin/cache`** — Deletes Herbie GRIB cache files (`subset_*.grib2`)
**`DELETE /api/admin/reset`** — Full reset: deletes all DB records, Zarr files, and GRIB cache

---

## 12. Pydantic Response Schemas

**File:** `app/schemas/forecast.py`

| Schema | Fields | Usage |
|---|---|---|
| `ModelRunOut` | id, model_name, init_time, forecast_hours, status, created_at | GET /api/runs response |
| `ForecastPointRequest` | lat, lon, variable, model_name?, init_time? | (defined but unused in current routes) |

**File:** `app/schemas/divergence.py`

| Schema | Fields | Usage |
|---|---|---|
| `PointMetricOut` | id, run_a_id, run_b_id, variable, lat, lon, lead_hour, rmse, bias, spread, created_at | GET /api/divergence/point response |
| `GridSnapshotOut` | id, init_time, variable, lead_hour, bbox, created_at | GET /api/divergence/grid/snapshots response |
| `GridDivergenceData` | variable, lead_hour, init_time, latitudes, longitudes, values (2D list), bbox | GET /api/divergence/grid response |
| `DivergenceSummary` | variable, mean_spread, max_spread, num_points, models_compared, init_time | GET /api/divergence/summary response |

All ORM-backed schemas use `model_config = {"from_attributes": True}` for automatic attribute-to-field mapping.

---

## 13. Admin CLI

**Files:** `scripts/admin.sh`, `scripts/admin.py`

The admin CLI is a shell wrapper (`admin.sh`) that invokes a Python script via `uv run`. It communicates with the running backend via HTTP calls to the admin API endpoints.

Commands:
- `admin.sh status` → `GET /api/admin/status`
- `admin.sh trigger GFS [--time ...]` → `POST /api/admin/trigger`
- `admin.sh clear runs|metrics|snapshots|cache` → `DELETE /api/admin/{target}`
- `admin.sh reset` → `DELETE /api/admin/reset`

The base URL defaults to `http://localhost:8000/api/admin` and can be overridden via the `SYNOPTIC_API_URL` environment variable.

---

## 14. Testing Strategy

The test suite uses `pytest` with `pytest-asyncio` (mode: `auto`). Tests are organized in three tiers:

### 14.1 Test Infrastructure (`conftest.py`)

**ARRAY-to-JSON patch:** Since tests run against SQLite (not PostgreSQL), the `ARRAY(INTEGER)` column type is monkey-patched at import time with a `TypeDecorator` that serializes Python lists to JSON text strings. This allows the full ORM stack to work with in-memory SQLite.

**Fixtures:**
- `db` — Creates a fresh in-memory SQLite database, runs `Base.metadata.create_all`, yields an `AsyncSession`, then disposes the engine
- `http_client` — Creates a `httpx.AsyncClient` with `ASGITransport(app=app)` and overrides `get_db` to use the `db` fixture's session. Tests using both `db` and `http_client` share the same session.

### 14.2 Unit Tests

| File | Tests | What's Tested |
|---|---|---|
| `test_metrics.py` | 5 | `extract_point` (exact + nearest), `compute_pairwise_metrics` (3 models → 3 pairs), `compute_ensemble_spread` (multi-model + single-model edge case) |
| `test_grid.py` | 3 | `regrid_to_common` (shape consistency), `compute_grid_divergence` (value correctness: std([10,12,8])=2.0), minimum-2-models requirement |
| `test_grid_zarr.py` | 6 | Zarr round-trip value preservation, path naming conventions, zero-padding, edge cases (missing variable, partial missing) |
| `test_ingestion.py` | 8 | Wind speed computation (3-4-5 triangle), GFS non-wind fetch, GFS wind speed from U/V, GFS partial failure handling, NAM fetch, ECMWF surface fetch, ECMWF wind speed, ECMWF partial failure handling |
| `test_scheduler.py` | 4 | `_latest_cycle` 6-hour boundary and round-down, idempotent skip of already-processed runs, error status on fetch failure |

### 14.3 Router Tests (`test_routers.py`)

13 tests that exercise the HTTP layer with fully mocked database sessions. Each test creates mock `AsyncSession` objects with pre-configured `execute()` return values, injects them via FastAPI dependency override, and asserts on HTTP status codes and JSON response shapes.

### 14.4 Integration Tests (`test_integration.py`)

20 tests that run the full stack: HTTP request → FastAPI router → SQLAlchemy query building → real SQLite execution → Pydantic serialization → JSON response. Tests insert real ORM objects into the SQLite database and verify end-to-end correctness including:
- Model run CRUD operations
- Query filtering (model_name, since, lead_hour, variable, proximity)
- Ordering (newest first)
- Summary aggregation (AVG, MAX, COUNT)
- Grid divergence loading (with mocked Zarr file)

### 14.5 Smoke Tests (`test_api.py`)

2 tests verifying `GET /api/health` returns 200 and `GET /api/variables` returns the expected variable dictionary.

---

## 15. Database Migrations

**Framework:** Alembic with async support via `asyncio.run()` in `env.py`.

The Alembic environment:
- Reads `DATABASE_URL` from `app.config.settings`
- Imports all models via `from app.models import *` to register them with `Base.metadata`
- Supports both offline (SQL script) and online (async engine) migration modes

**Migration `39a5ab22268c` (initial):**
- Creates `model_runs`, `point_metrics`, and `grid_snapshots` tables with all columns, constraints, and indexes as documented in the Storage Schema section
- Downgrade drops all tables and indexes in reverse order

---

## 16. Docker & Deployment

### 16.1 Production Dockerfile (root)

Two-stage build:

**Stage 1 — Frontend (Node 22 Alpine):**
1. Copy `frontend/package*.json`, run `npm ci`
2. Copy full `frontend/`, run `npm run build` → produces `/app/dist`

**Stage 2 — Backend (Python 3.12 slim):**
1. Install `libeccodes-dev` system package (required by cfgrib/eccodes)
2. Copy `backend/pyproject.toml`, run `pip install .` (leverages Docker layer caching)
3. Copy full `backend/` source
4. Copy `frontend_dist/` from stage 1
5. Expose port 8000, run `uvicorn app.main:app --host 0.0.0.0 --port 8000`

FastAPI detects the `frontend_dist/` directory at startup and serves it as static files.

### 16.2 Docker Compose (local development)

Three-container setup:
- **db:** PostgreSQL 16 Alpine with persistent volume
- **backend:** Built from `backend/Dockerfile`, connects to `db`, mounts data volume
- **frontend:** Built from `frontend/Dockerfile`, serves on port 5173

### 16.3 Render Blueprint (`render.yaml`)

Single-click deployment provisioning:
- **Web service:** Uses root Dockerfile, Starter plan, health check at `/api/health`, 20GB persistent disk at `/data`
- **Database:** Managed PostgreSQL (free tier), `DATABASE_URL` auto-injected from database connection string
- **Environment:** `DATABASE_AUTO_CREATE=true` for first-boot ORM table creation, `SCHEDULER_ENABLED=true`

---

## 17. Dependency Inventory

### Production Dependencies

| Package | Version | Purpose |
|---|---|---|
| `fastapi` | ≥0.115.0 | Async web framework |
| `uvicorn[standard]` | ≥0.32.0 | ASGI server with libuv event loop |
| `sqlalchemy[asyncio]` | ≥2.0.0 | Async ORM |
| `asyncpg` | ≥0.30.0 | PostgreSQL async driver |
| `alembic` | ≥1.14.0 | Database migrations |
| `pydantic-settings` | ≥2.6.0 | Configuration management |
| `herbie-data` | ≥2024.9.0 | GRIB2 data access from NOAA NOMADS |
| `ecmwf-opendata` | ≥0.3.0 | ECMWF IFS real-time forecast data access (no API key) |
| `xarray` | ≥2024.11.0 | Multi-dimensional labeled arrays |
| `cfgrib` | ≥0.9.15 | GRIB2 to xarray via eccodes |
| `metpy` | ≥1.6.0 | Meteorological calculations (dependency of herbie) |
| `zarr` | ≥2.18.0 | Chunked compressed array storage |
| `apscheduler` | ≥3.11.0 | In-process cron scheduler |
| `numpy` | ≥2.1.0 | Numerical array operations |
| `pandas` | ≥2.2.0 | Tabular data (xarray dependency) |
| `httpx` | ≥0.28.0 | Async HTTP client |
| `python-dotenv` | ≥1.0.0 | `.env` file loading |

### Development Dependencies

| Package | Version | Purpose |
|---|---|---|
| `pytest` | ≥8.3.0 | Test framework |
| `pytest-asyncio` | ≥0.24.0 | Async test support |
| `pytest-httpx` | ≥0.35.0 | HTTPX mocking |
| `ruff` | ≥0.8.0 | Linter and formatter |

### System Dependencies (Docker)

| Package | Purpose |
|---|---|
| `libeccodes-dev` | C library for GRIB2 decoding (required by cfgrib) |
