# SynopticSpread

Track divergence between global NWP models (GFS, NAM, ECMWF, HRRR) in near-real-time. The system ingests GRIB2 data every 6 hours, computes point-level and grid-level divergence metrics, stores them in PostgreSQL, and serves them through a FastAPI + React dashboard.

## Stack

- **Backend**: FastAPI, SQLAlchemy (async), Alembic, APScheduler, xarray, herbie-data, ecmwf-opendata
- **Frontend**: React 19, Vite, Tailwind v4, React Query, Leaflet, Recharts
- **Storage**: PostgreSQL (metrics), Zarr files (2D divergence grids)
- **Data sources**: NOAA NOMADS (GFS/NAM/HRRR via herbie), ECMWF Open Data (IFS via ecmwf-opendata)

## Deploy to Render

`render.yaml` in the repo root is a [Render Blueprint](https://render.com/docs/blueprint-spec). Click **New Blueprint** in the Render dashboard, point it at this repo, and Render provisions the web service, PostgreSQL database, and persistent disk automatically.

> The web service requires at least the Starter plan ($7/mo). The free PostgreSQL tier has a 90-day limit — upgrade to Basic ($7/mo) for production.

All models (GFS, NAM, HRRR, ECMWF) are ingested automatically — no API keys required.

In production, a single Docker container (root `Dockerfile`) runs uvicorn and serves both the API and the compiled frontend — no separate nginx needed.

## Quickstart (Docker)

```bash
cp .env.example backend/.env

docker compose up --build
```

| Service | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:8000 |
| API docs | http://localhost:8000/docs |

`docker-compose.yml` is for local development only (three separate containers). The root `Dockerfile` is the production image.

## Local Development

### Backend

```bash
cd backend
uv pip install -e ".[dev]" aiosqlite scipy   # aiosqlite + scipy required for tests
cp ../.env.example .env                      # edit as needed

# Option A: start PostgreSQL via Docker
docker compose up db -d

# Option B: use a local PostgreSQL install (no Docker required)
# sudo apt-get install postgresql && sudo service postgresql start

uv run alembic upgrade head
uv run uvicorn app.main:app --reload
```

Set `SCHEDULER_ENABLED=false` in `.env` to run the API without triggering ingestion jobs.

```bash
SCHEDULER_ENABLED=false uv run pytest   # run tests
uv run ruff check .                     # lint
```

### Frontend

```bash
cd frontend
npm install
npm run dev        # dev server on :5173, proxies /api → http://localhost:8000
npm run lint

# E2E tests (Playwright — starts dev server automatically)
npx playwright install --with-deps chromium   # first time only
npx playwright test
```

## Environment Variables

Copy `.env.example` to `backend/.env`:

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | local postgres | asyncpg connection string |
| `DATA_STORE_PATH` | `./data` | Directory where Zarr divergence grids are written |
| `SCHEDULER_ENABLED` | `true` | Set to `false` for API-only / test mode |
| `DATABASE_AUTO_CREATE` | `false` | Create ORM tables on startup without Alembic (used by Render) |
| `ALLOWED_ORIGINS` | `["http://localhost:5173"]` | CORS allowed origins (JSON list) |

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/variables` | Canonical variable names |
| GET | `/api/runs` | Model run history |
| GET | `/api/divergence/point` | Point-level RMSE/bias/spread |
| GET | `/api/divergence/grid` | 2D divergence grid for a variable + lead hour |
| GET | `/api/divergence/grid/snapshots` | List available grid snapshots |
| GET | `/api/divergence/summary` | Latest spread summary per variable |

### Admin Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/status` | Counts of runs, metrics, snapshots, and zarr files |
| POST | `/api/admin/trigger` | Queue ingestion for a model (`{"model":"GFS","init_time":"..."}`) |
| DELETE | `/api/admin/runs` | Delete all ModelRun records |
| DELETE | `/api/admin/metrics` | Delete all PointMetric records |
| DELETE | `/api/admin/snapshots` | Delete GridSnapshot records + zarr files on disk |
| DELETE | `/api/admin/cache` | Delete cached herbie GRIB subset files |
| DELETE | `/api/admin/reset` | Full reset — all DB records, zarr files, and GRIB cache |

Use `scripts/admin.sh` to call these from the command line without writing curl commands:

```bash
./scripts/admin.sh status
./scripts/admin.sh trigger GFS --time 2026-02-25T18:00:00
./scripts/admin.sh clear runs
./scripts/admin.sh reset
```

## Scheduler

Ingestion runs automatically via APScheduler inside the backend process:

- **ECMWF**: 05:00, 11:00, 17:00, 23:00 UTC
- **HRRR**: 05:15, 11:15, 17:15, 23:15 UTC
- **GFS**: 05:30, 11:30, 17:30, 23:30 UTC
- **NAM**: 05:45, 11:45, 17:45, 23:45 UTC

The pipeline is idempotent — re-running a cycle that already succeeded is a no-op.

## Tracked Variables

| Key | Description |
|---|---|
| `precip` | Total precipitation |
| `wind_speed` | 10m wind speed |
| `mslp` | Mean sea-level pressure |
| `hgt_500` | 500mb geopotential height |

## Monitored Points

Twenty US cities are pre-configured (New York, Los Angeles, Chicago, Houston, Seattle, Denver, Miami, Washington DC, Atlanta, Boston, Minneapolis, Phoenix, San Francisco, Dallas, Portland, Detroit, Nashville, Columbus, Charlotte, San Diego). Add or change them via `monitor_points` in `backend/app/config.py`.
