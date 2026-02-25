# SynopticSpread

Track divergence between global NWP models (GFS, NAM, ECMWF) in near-real-time. The system ingests GRIB2 data every 6 hours, computes point-level and grid-level divergence metrics, stores them in PostgreSQL, and serves them through a FastAPI + React dashboard.

## Stack

- **Backend**: FastAPI, SQLAlchemy (async), Alembic, APScheduler, xarray, herbie-data, cdsapi
- **Frontend**: React 19, Vite, Tailwind v4, React Query, Leaflet, Recharts
- **Storage**: PostgreSQL (metrics), Zarr files (2D divergence grids)
- **Data sources**: NOAA NOMADS (GFS/NAM via herbie), ECMWF Open Data (via cdsapi)

## Quickstart (Docker)

```bash
cp .env.example backend/.env
# Add your ECMWF API key to backend/.env if you want ECMWF data

docker compose up --build
```

| Service | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:8000 |
| API docs | http://localhost:8000/docs |

## Local Development

### Backend

```bash
cd backend
pip install -e ".[dev]"
cp ../.env.example .env   # edit as needed

# Start PostgreSQL first
docker compose up db -d

alembic upgrade head
uvicorn app.main:app --reload
```

Set `SCHEDULER_ENABLED=false` in `.env` to run the API without triggering ingestion jobs.

### Frontend

```bash
cd frontend
npm install
npm run dev   # proxies /api to http://localhost:8000
```

## Environment Variables

Copy `.env.example` to `backend/.env`:

| Variable | Description |
|---|---|
| `DATABASE_URL` | asyncpg connection string |
| `ECMWF_API_KEY` | Required for ECMWF ingestion — get from [Copernicus CDS](https://cds.climate.copernicus.eu) |
| `DATA_STORE_PATH` | Directory where Zarr divergence grids are written |
| `SCHEDULER_ENABLED` | Set to `false` for API-only mode |

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

## Scheduler

Ingestion runs automatically via APScheduler inside the backend process:

- **GFS**: 01:30, 07:30, 13:30, 19:30 UTC
- **NAM**: 01:45, 07:45, 13:45, 19:45 UTC
- **ECMWF**: 14:00 UTC daily

The pipeline is idempotent — re-running a cycle that already succeeded is a no-op.

## Tracked Variables

| Key | Description |
|---|---|
| `precip` | Total precipitation |
| `wind_speed` | 10m wind speed |
| `mslp` | Mean sea-level pressure |
| `hgt_500` | 500mb geopotential height |

## Monitored Points

Eight US cities are pre-configured (New York, Los Angeles, Chicago, Houston, Seattle, Denver, Miami, Washington DC). Add or change them via `monitor_points` in `backend/app/config.py`.
