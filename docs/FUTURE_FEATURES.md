# Future Features and Improvements

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

## Additional Model Sources

- **HRRR** (High-Resolution Rapid Refresh): 3km CONUS grid, hourly cycles.
  Add `HRRRFetcher` subclass using herbie-data, update scheduler cron schedule.
- **UKMET**: Global model from the UK Met Office.
- **Canadian GEM/GDPS**: Additional global perspective from Environment Canada.
- **ICON**: DWD's global model.

## Alerting and Notifications

- Define alert thresholds per variable per location (configurable via UI or
  `.env`).
- Send email/Slack/webhook when spread exceeds threshold for N consecutive
  forecast hours.
- Dashboard banner for active alerts with link to the relevant time series.
- Digest emails summarizing daily divergence trends.

## Enhanced Map Features

- **True Voronoi tessellation**: Use `d3-delaunay` to compute actual Voronoi
  polygons from monitor point coordinates instead of fixed-radius circles.
- **Animated time-step playback**: Auto-advance lead hour with play/pause and
  speed controls so users can watch divergence evolve over the forecast horizon.
- **Click-anywhere point query**: Restore the ability to click any map location
  (not just preset cities) and query point divergence at arbitrary coordinates.
- **Wind barb overlay**: Show where models disagree on wind direction, not just
  speed.
- **Multi-variable split-screen**: Side-by-side map views comparing two
  variables simultaneously.

## Ensemble Spread Decomposition

- Break down ensemble spread into model-pair contributions (GFS-NAM, GFS-ECMWF,
  NAM-ECMWF) so users can see which pair is most divergent.
- Per-member spaghetti plots on the time series chart.
- Rank-histogram verification once observational data is integrated.

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
