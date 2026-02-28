# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Backend (run from `backend/`)

```bash
# Install dependencies (aiosqlite + scipy required for tests)
uv pip install -e ".[dev]" aiosqlite scipy

# Run dev server
uv run uvicorn app.main:app --reload

# Run all tests (disable scheduler to avoid side-effects)
SCHEDULER_ENABLED=false uv run pytest

# Run a single test file
SCHEDULER_ENABLED=false uv run pytest tests/test_metrics.py

# Run a single test
SCHEDULER_ENABLED=false uv run pytest tests/test_metrics.py::test_pairwise_metrics

# Lint / format
uv run ruff check .
uv run ruff format .

# Database migrations
uv run alembic revision --autogenerate -m "description"
uv run alembic upgrade head
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

### Admin CLI (from repo root)

```bash
# Shortcut wrapper — works from any directory
./scripts/admin.sh status                          # counts + recent runs
./scripts/admin.sh trigger GFS                     # queue latest GFS cycle
./scripts/admin.sh trigger GFS --time 2026-02-25T18:00:00  # specific cycle
./scripts/admin.sh trigger NAM
./scripts/admin.sh trigger ECMWF
./scripts/admin.sh clear runs                      # delete ModelRun records
./scripts/admin.sh clear metrics                   # delete PointMetric records
./scripts/admin.sh clear snapshots                 # delete GridSnapshot + zarr files
./scripts/admin.sh clear cache                     # delete herbie subset_*.grib2 files
./scripts/admin.sh reset                           # full reset (prompts for confirmation)
```

Override the API base URL with `SYNOPTIC_API_URL=http://host:port/api/admin ./scripts/admin.sh ...`

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

All models (GFS, NAM, HRRR, ECMWF) are ingested automatically — no API keys required.

### Production Docker image

The root `Dockerfile` is a two-stage build:
1. **Node 22**: builds the Vite frontend → `/app/dist`
2. **Python 3.12-slim**: installs the backend, copies `dist` into `frontend_dist/`, runs uvicorn

FastAPI detects `frontend_dist/` at startup and mounts it as static files, so the single container serves both the API and the SPA. `docker-compose.yml` is for **local development only** (three separate containers).

## Architecture

### Data flow

The scheduler (`app/services/scheduler.py`) fires APScheduler cron jobs at 09:00/15:00/21:00/03:00 UTC for ECMWF (IFS data takes 7-9h to publish), 05:15/11:15/17:15/23:15 UTC for HRRR, 05:30/11:30/17:30/23:30 UTC for GFS, and 05:45/11:45/17:45/23:45 UTC for NAM. NOMADS models fire ~5h after each cycle; ECMWF fires ~9h after to allow for slower IFS data publication. Each job calls `ingest_and_process(model_name)`, which:

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
    alert.py          — AlertRule, AlertEvent
  routers/
    forecasts.py      — GET /api/variables, GET /api/runs
    divergence.py     — GET /api/divergence/point|grid|grid/snapshots|summary|regional|decomposition
    alerts.py         — GET/POST/PUT/DELETE /api/alerts/rules, GET/POST /api/alerts/events
    admin.py          — GET /api/admin/status, POST /trigger, DELETE /runs|metrics|snapshots|cache|reset
  services/
    ingestion/
      base.py         — ModelFetcher ABC; canonical variable names (precip, wind_speed, mslp, hgt_500)
      gfs.py          — GFSFetcher using herbie-data
      nam.py          — NAMFetcher using herbie-data
      ecmwf.py        — ECMWFFetcher using ecmwf-opendata (IFS real-time forecasts, no API key)
      hrrr.py         — HRRRFetcher using herbie-data (3km CONUS, Lambert Conformal like NAM)
    processing/
      metrics.py      — extract_point, compute_pairwise_metrics, compute_ensemble_spread
      grid.py         — regrid_to_common, compute_grid_divergence, save/load_divergence_zarr
    alerts.py         — check_alerts (threshold checking + webhook notifications)
    scheduler.py      — APScheduler jobs wiring ingestion + processing + alert checking
  schemas/            — Pydantic response models (mirrors DB models)
```

### Key contracts

- All fetchers return `dict[int, xr.Dataset]` where keys are lead hours and each Dataset uses `latitude`/`longitude` as coordinate names with canonical variable names.
- GFS and ECMWF (IFS) use regular 1D lat/lon grids (0.25°). NAM CONUSNEST and HRRR use Lambert Conformal projection with 2D `(y, x)` `latitude`/`longitude` auxiliary coordinates. Both `extract_point` (metrics.py) and `regrid_to_common` (grid.py) handle both coordinate dimensionalities — check `lat_coord.ndim` before choosing code path.
- Grid divergence is per-grid-cell std-dev (ddof=1) across all available models, regridded to a common 0.25° grid.
- The scheduler is idempotent: it checks for an existing `ModelRun` row before fetching.
- Herbie requires timezone-naive datetimes; always call `init_time.replace(tzinfo=None)` before passing to `Herbie()`.

### Frontend

React + Vite + Tailwind v4. Four pages:

- `DashboardPage` — divergence summary cards, alert banner, pair contributions
- `MapPage` — Leaflet map with grid/regional/Voronoi overlays and animated playback
- `TimeSeriesPage` — Recharts time-series plots with aggregate and per-pair decomposition views
- `AlertsPage` — alert rules management and event history

All API calls are in `src/api/client.ts` as React Query hooks. The base URL is controlled by `VITE_API_URL` (defaults to `/api`). In development, Vite proxies `/api` → `http://localhost:8000`. In Docker, nginx proxies it.

### Environment variables

Configured in `backend/.env` (copy from `.env.example`):

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | postgres on localhost | Use `postgresql+asyncpg://` scheme |
| `DATA_STORE_PATH` | `./data` | Where Zarr divergence grids are written |
| `SCHEDULER_ENABLED` | `true` | Set to `false` for API-only / test mode |
| `DATABASE_AUTO_CREATE` | `false` | Creates ORM tables on startup without Alembic (used in prod/Render) |
| `ALLOWED_ORIGINS` | `["http://localhost:5173"]` | CORS allowed origins (JSON list or comma-separated) |
| `ALERT_WEBHOOK_URL` | — | Optional webhook URL for alert notifications (Slack/email) |
| `ALERT_CHECK_ENABLED` | `true` | Toggle alert threshold checking after metric computation |
