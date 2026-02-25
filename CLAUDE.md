# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Backend (run from `backend/`)

```bash
# Install dependencies (add aiosqlite and scipy for the full test suite)
pip install -e ".[dev]" aiosqlite scipy

# Run dev server
uvicorn app.main:app --reload

# Run all tests (disable scheduler to avoid side-effects)
SCHEDULER_ENABLED=false pytest

# Run a single test file
SCHEDULER_ENABLED=false pytest tests/test_metrics.py

# Run a single test
SCHEDULER_ENABLED=false pytest tests/test_metrics.py::test_pairwise_metrics

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

# E2E tests (Playwright – starts dev server automatically)
npx playwright install --with-deps chromium   # first time only
npx playwright test
npx playwright test e2e/dashboard.spec.ts     # single file
```

### Docker (from repo root)

```bash
# Local dev stack (three separate containers + nginx)
docker compose up --build
docker compose up db              # just the database
docker compose logs -f backend

# Production image (single container – FastAPI serves bundled frontend)
docker build -t synopticspread .
docker run -p 8000:8000 --env-file backend/.env synopticspread
```

## Deployment

### Render (one-click)

`render.yaml` at the repo root is a Render Blueprint. In the Render dashboard select **New Blueprint**, point it at the repo, and Render provisions:
- A web service using the root `Dockerfile` (Starter plan minimum, $7/mo)
- A managed PostgreSQL database (free tier, 90-day limit)
- A 20 GB persistent disk mounted at `/data` for Zarr files

Set `ECMWF_API_KEY` in the Render environment panel if ECMWF ingestion is needed.

### Production Docker image

The root `Dockerfile` is a two-stage build:
1. **Node 22**: builds the Vite frontend → `/app/dist`
2. **Python 3.12-slim**: installs the backend, copies `dist` into `frontend_dist/`, runs uvicorn

FastAPI detects `frontend_dist/` at startup and mounts it as static files, so the single container serves both the API and the SPA. `docker-compose.yml` is for **local development only** (three separate containers).

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
| `ECMWF_API_KEY` | — | Required for ECMWF ingestion; leave empty to skip |
| `DATA_STORE_PATH` | `./data` | Where Zarr divergence grids are written |
| `SCHEDULER_ENABLED` | `true` | Set to `false` for API-only / test mode |
| `DATABASE_AUTO_CREATE` | `false` | Creates ORM tables on startup without Alembic (used in prod/Render) |
| `ALLOWED_ORIGINS` | `["http://localhost:5173"]` | CORS allowed origins (JSON list or comma-separated) |
