## 🔥 Project Name Ideas (Lane A – Raw Model Files)


## Prompt

You are building a production-grade Python system called **SynopticSpread**.

The goal is to create a weather model divergence tracker using:

* NOAA GFS deterministic runs (GRIB2) via NOMADS
* GEFS ensemble runs via NOMADS
* ECMWF deterministic + ensemble via ECMWF Open Data

The system must:

1. Automatically ingest new model runs every 6 hours (00/06/12/18 UTC)
2. Download only required variables and spatial subsets
3. Convert GRIB2 data into compact internal format (NetCDF or Parquet)
4. Compute deterministic divergence metrics between GFS and ECMWF
5. Compute ensemble spread metrics
6. Store derived metrics in a queryable database
7. Expose a simple FastAPI backend

---

# Technical Requirements

## 1️⃣ Architecture

Implement the following structure:

```
synopticspread/
│
├── config/
│   └── regions.yaml
│
├── ingestion/
│   ├── gfs_downloader.py
│   ├── gefs_downloader.py
│   ├── ecmwf_downloader.py
│
├── processing/
│   ├── grib_to_xarray.py
│   ├── spatial_subset.py
│   ├── feature_engineering.py
│   ├── storm_tracking.py
│
├── storage/
│   ├── parquet_writer.py
│   ├── database.py
│
├── api/
│   └── main.py  (FastAPI app)
│
├── scheduler/
│   └── run_cycle.py
│
└── requirements.txt
```

Use:

* Python 3.11+
* xarray
* cfgrib
* eccodes
* numpy
* pandas
* pyproj
* shapely
* fastapi
* sqlalchemy
* boto3 (optional future S3 support)

---

## 2️⃣ Data Ingestion Details

### GFS

Download from NOMADS:

* 0.25° resolution
* Variables:

  * 2m temperature
  * 10m wind (u, v)
  * mean sea level pressure
  * total precipitation
  * 850mb temperature
  * 500mb geopotential height

Use HTTP range requests via index files to avoid downloading full grids.

---

### GEFS

* 0.5° resolution
* Download control + ensemble members
* Limit to forecast hours 0–120 for MVP

---

### ECMWF

Use ECMWF Open Data.
Download:

* Deterministic HRES
* ENS members

Same variable list as GFS.

---

## 3️⃣ Spatial Subsetting

Use bounding boxes defined in:

`config/regions.yaml`

Example region:

```yaml
nyc_metro:
  lat_min: 39.5
  lat_max: 42.0
  lon_min: -75.5
  lon_max: -71.0
```

All GRIB data must be subset immediately after loading to reduce memory footprint.

---

## 4️⃣ Divergence Metrics

For each region and forecast hour τ:

### Deterministic

Compute:

* Mean absolute difference of 2m temp
* Mean absolute difference of QPF
* Mean absolute difference of MSLP
* Cyclone center difference:

  * Find minimum MSLP in larger domain
  * Compute distance between centers (km)
  * Compute pressure difference

Create a composite divergence index:

```
D = w1*norm(temp_diff)
  + w2*norm(qpf_diff)
  + w3*norm(mslp_diff)
  + w4*norm(track_distance)
```

Make weights configurable.

---

### Ensemble Metrics

For each model:

* Compute regional mean per ensemble member
* Compute standard deviation (spread)
* Compute cross-model ratio:

```
ratio = |mean_gfs - mean_ecmwf| / (spread_gfs + spread_ecmwf + epsilon)
```

Store all components separately.

---

## 5️⃣ Storage

Write:

* Raw regional time series → Parquet (partitioned by run_time/model/region)
* Derived metrics → PostgreSQL table:

```
divergence_metrics(
  run_time TIMESTAMP,
  forecast_hour INT,
  region TEXT,
  temp_diff FLOAT,
  qpf_diff FLOAT,
  mslp_diff FLOAT,
  track_distance FLOAT,
  composite_score FLOAT,
  gfs_spread FLOAT,
  ecmwf_spread FLOAT,
  cross_model_ratio FLOAT
)
```

---

## 6️⃣ FastAPI Endpoints

Implement:

```
GET /regions
GET /divergence/{region}
GET /latest/{region}
GET /run/{run_time}/{region}
```

Return JSON formatted for plotting.

---

## 7️⃣ Scheduler

Implement a scheduler that:

* Detects new model runs
* Executes ingestion + processing pipeline
* Logs failures
* Is idempotent (safe to rerun)

Can be run via:

```
python scheduler/run_cycle.py
```

---

## 8️⃣ Code Quality

* Fully typed Python
* Clear docstrings
* Modular functions
* Logging with structured logs
* No hardcoded paths
* All config externalized

---

## 9️⃣ Future Hooks (Design for Extensibility)

Architect system so future additions are easy:

* Additional models (HRRR, UKMET)
* Additional variables (HDD/CDD aggregation)
* S3 storage
* Backtesting module
* Alerting engine

---

# Deliverables Expected from You (Codex/Claude)

1. Full repository scaffold
2. Working ingestion for GFS deterministic
3. Working divergence computation between GFS and ECMWF
4. FastAPI app returning computed metrics
5. Setup instructions


