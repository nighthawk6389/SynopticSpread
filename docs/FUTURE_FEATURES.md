# Future Features and Improvements

## Recently Completed

### Additional Model Sources (HRRR)
- **HRRR** fetcher added (`HRRRFetcher`) using herbie-data, 3km CONUS grid, 6h lead-hour steps (0-48h).
- Registered in scheduler with cron job at minute 15 of each 6-hour cycle.
- Added to admin VALID_MODELS.

### Alerting and Notifications
- `AlertRule` and `AlertEvent` database models for configurable thresholds.
- CRUD API endpoints at `/api/alerts/rules` and `/api/alerts/events`.
- Alert checking integrated into scheduler — fires after each metric computation.
- Webhook notifications via `ALERT_WEBHOOK_URL` env var (Slack/email compatible).
- Dashboard banner showing active alerts with link to alerts page.
- Dedicated Alerts page with rules management and event history.

### Enhanced Map Features
- **Voronoi tessellation**: `d3-delaunay` computes true Voronoi polygons from monitor points.
- **Animated time-step playback**: Play/pause with 1x/2x/4x speed to watch divergence evolve.
- **20 preset cities**: Expanded from 8 to 20 US cities for better CONUS coverage.

### Ensemble Spread Decomposition
- `/api/divergence/decomposition` endpoint returns per-model-pair RMSE/bias by lead hour.
- Time Series page: "Per-Pair Decomposition" view with spaghetti-style per-pair lines.
- Dashboard: "Pair Contributions" section with horizontal bar chart showing which pair diverges most.

---

## Data History and Long-Term Analysis

The current schema (`point_metrics` table) accumulates data indefinitely.
PointMetric rows are never deleted during normal operation, so historical data
builds up naturally over time.

### Near-term

- Add `since`/`until` date-range query params to `GET /api/divergence/point`
  and `GET /api/divergence/summary` so the frontend can request specific windows.
- Add a date range picker to the Time Series page.
- Increase the `limit` default (currently 50) and support pagination (`offset`).

### Long-term (years of data)

- Implement hourly/daily/weekly rollup tables materialized via scheduled SQL or
  an Alembic migration:
  ```
  daily_spread_rollup(date, variable, lat, lon, avg_spread, max_spread, min_spread, count)
  ```
- Switch the Time Series chart to display rollups when the time range exceeds
  30 days; show raw data for shorter ranges.
- Consider TimescaleDB hypertables for automatic time-based partitioning and
  continuous aggregates.
- Archive raw PointMetric rows older than N months to cold storage (S3/Parquet)
  while keeping rollups in PostgreSQL.

## Additional Model Sources (remaining)

- **UKMET**: Global model from the UK Met Office.
- **Canadian GEM/GDPS**: Additional global perspective from Environment Canada.
- **ICON**: DWD's global model.

## Enhanced Map Features (remaining)

- **Click-anywhere point query**: Click any map location (not just preset
  cities) and query point divergence at arbitrary coordinates.
- **Wind barb overlay**: Show where models disagree on wind direction, not just
  speed.
- **Multi-variable split-screen**: Side-by-side map views comparing two
  variables simultaneously.

## Ensemble Spread Decomposition (remaining)

- Rank-histogram verification once observational data is integrated.

## Alerting Enhancements

- Digest emails summarizing daily divergence trends.
- Configurable alert thresholds via `.env` (in addition to UI).

## Observational Verification

- Ingest surface observations (METAR/SYNOP via Iowa Environmental Mesonet or
  Synoptic Data) to compute model-vs-observation error alongside model-vs-model
  divergence.
- Show verification scores (MAE, bias, skill scores) on the dashboard alongside
  divergence metrics.

## User Preferences

- Persist selected location, variable, and overlay mode in `localStorage` so
  selections survive page reloads.
- Dark/light theme toggle (currently dark-only).
- Configurable monitor points via the UI (add/remove/rename cities).
- Saved views: let users bookmark a specific variable + location + lead hour
  combination.

## Performance and Scalability

- **WebSocket push**: Notify the frontend when new model runs complete so
  dashboards update without polling.
- **Redis caching layer**: Cache expensive summary and regional queries with
  short TTLs (5-15 minutes).
- **Pre-rendered tile images**: Convert Zarr divergence grids to PNG tiles via
  matplotlib/rasterio and serve through a tile server, eliminating the need to
  ship large JSON grids to the browser.
- **CDN for static tile overlays**: Cache rendered tiles at the edge.
- **Connection pooling**: Tune asyncpg pool size as concurrent users grow.

## Mobile and Accessibility

- Responsive layout improvements for the map page (tight on small screens).
- Touch-friendly controls (slider, popups).
- ARIA labels on all interactive controls (selects, tooltips, modals).
- Keyboard navigation for click-to-toggle tooltip popups (Enter/Space to open,
  Escape to close).
- Screen-reader-friendly chart descriptions via `aria-label` on SVG elements.

## API Enhancements

- **GraphQL layer**: For frontend clients that need flexible field selection
  and nested queries (e.g., "give me runs with their metrics in one call").
- **Bulk export**: CSV/Parquet download endpoint for point metrics over a date
  range.
- **API versioning**: `/api/v1/...` prefix to allow breaking changes in future
  versions.
- **Rate limiting**: Per-IP throttling on public-facing endpoints.

## Testing

- Backend integration tests with a seeded PostgreSQL database (currently uses
  SQLite for unit tests).
- Visual regression tests for the map overlay using Playwright screenshot
  comparison.
- Load testing for the grid endpoint with large Zarr files (k6 or Locust).
- Contract testing between frontend hooks and backend response schemas.
