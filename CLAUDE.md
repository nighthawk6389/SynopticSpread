# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Backend (run from `backend/`)

```bash
# Install dependencies
pip install -e ".[dev]"

# Run dev server
uvicorn app.main:app --reload

# Run all tests
pytest

# Run a single test file
pytest tests/test_metrics.py

# Run a single test
pytest tests/test_metrics.py::test_pairwise_metrics

# Lint
ruff check .

# Format
ruff format .

# Database migrations
alembic revision --autogenerate -m "description"
alembic upgrade head
```

### Frontend (run from `frontend/`)

```bash
npm install
npm run dev       # dev server on :5173
npm run build     # production build
npm run lint
```

### Docker (from repo root)

```bash
docker compose up --build         # start all services
docker compose up db              # just the database
docker compose logs -f backend
```

## Architecture

### Data flow

The scheduler (`app/services/scheduler.py`) fires APScheduler cron jobs at 01:30, 07:30, 13:30, 19:30 UTC for GFS/NAM and 14:00 UTC for ECMWF. Each job calls `ingest_and_process(model_name)`, which:

1. Fetches GRIB2 data via a `ModelFetcher` subclass → returns `dict[lead_hour, xr.Dataset]`
2. Computes pairwise RMSE/bias at each configured monitor point (`settings.monitor_points`) → stored as `PointMetric` rows in PostgreSQL
3. Computes per-grid-cell std-dev across models → saved as Zarr files under `DATA_STORE_PATH/divergence/{init_time}/{variable}/fhr{NNN}.zarr`
4. Records a `GridSnapshot` row pointing to each Zarr file

### Backend package layout

```
backend/app/
  config.py           — pydantic-settings (reads .env); defines monitor_points
  database.py         — async SQLAlchemy engine + session factory
  main.py             — FastAPI app, CORS, lifespan (starts/stops scheduler)
  models/
    model_run.py      — ModelRun (tracks ingestion status), RunStatus enum
    divergence.py     — PointMetric, GridSnapshot
  routers/
    forecasts.py      — GET /api/variables, GET /api/runs
    divergence.py     — GET /api/divergence/point|grid|grid/snapshots|summary
  services/
    ingestion/
      base.py         — ModelFetcher ABC; canonical variable names (precip, wind_speed, mslp, hgt_500)
      gfs.py          — GFSFetcher using herbie-data
      nam.py          — NAMFetcher using herbie-data
      ecmwf.py        — ECMWFFetcher using cdsapi (requires ECMWF_API_KEY)
    processing/
      metrics.py      — extract_point, compute_pairwise_metrics, compute_ensemble_spread
      grid.py         — regrid_to_common, compute_grid_divergence, save/load_divergence_zarr
    scheduler.py      — APScheduler jobs wiring ingestion + processing
  schemas/            — Pydantic response models (mirrors DB models)
```

### Key contracts

- All fetchers return `dict[int, xr.Dataset]` where keys are lead hours and each Dataset uses `latitude`/`longitude` as coordinate names with canonical variable names.
- Grid divergence is per-grid-cell std-dev (ddof=1) across all available models, regridded to a common 0.25° grid.
- The scheduler is idempotent: it checks for an existing `ModelRun` row before fetching.

### Frontend

React + Vite + Tailwind v4. Three pages:

- `DashboardPage` — divergence summary cards
- `MapPage` — Leaflet map with `DivergenceOverlay` heatmap
- `TimeSeriesPage` — Recharts time-series plots

All API calls are in `src/api/client.ts` as React Query hooks. The base URL is controlled by `VITE_API_URL` (defaults to `/api`). In development, Vite proxies `/api` → `http://localhost:8000`. In Docker, nginx proxies it.

### Environment variables

Configured in `backend/.env` (copy from `.env.example`):

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | postgres on localhost | Use `postgresql+asyncpg://` scheme |
| `ECMWF_API_KEY` | — | Required for ECMWF ingestion |
| `DATA_STORE_PATH` | `./data` | Where Zarr divergence grids are written |
| `SCHEDULER_ENABLED` | `true` | Set to `false` for API-only mode |

Frontend env (set in Vercel or `.env.local`):

| Variable | Default | Notes |
|---|---|---|
| `VITE_API_URL` | `/api` | Full URL to backend `/api` prefix for non-proxied deploys |
