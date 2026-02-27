/**
 * Shared mock data and API-route setup for Playwright e2e tests.
 *
 * All API calls are intercepted at the browser level via page.route() so the
 * backend does not need to be running during the test suite.
 *
 * Route registration order matters: Playwright uses LIFO (last-in, first-out)
 * matching, so more specific routes must be registered AFTER broader ones.
 */

import type { Page } from '@playwright/test'

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

export const MOCK_SUMMARIES = [
  {
    variable: 'precip',
    mean_spread: 1.23,
    max_spread: 4.56,
    min_spread: 0.01,
    num_points: 10,
    models_compared: ['GFS', 'NAM', 'ECMWF', 'HRRR'],
    init_time: 'latest',
  },
  {
    variable: 'wind_speed',
    mean_spread: 0.87,
    max_spread: 2.34,
    min_spread: 0.05,
    num_points: 8,
    models_compared: ['GFS', 'NAM', 'ECMWF', 'HRRR'],
    init_time: 'latest',
  },
]

export const MOCK_RUNS = [
  {
    id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    model_name: 'GFS',
    init_time: '2024-01-15T00:00:00Z',
    forecast_hours: [0, 6, 12, 24, 48, 72],
    status: 'complete',
    created_at: '2024-01-15T01:30:00Z',
  },
  {
    id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    model_name: 'NAM',
    init_time: '2024-01-15T00:00:00Z',
    forecast_hours: [0, 6, 12, 24],
    status: 'pending',
    created_at: '2024-01-15T01:45:00Z',
  },
  {
    id: 'c3d4e5f6-a7b8-9012-cdef-012345678902',
    model_name: 'ECMWF',
    init_time: '2024-01-15T00:00:00Z',
    forecast_hours: [0],
    status: 'error',
    created_at: '2024-01-15T02:00:00Z',
  },
  {
    id: 'd4e5f6a7-b8c9-0123-defg-123456789012',
    model_name: 'HRRR',
    init_time: '2024-01-15T00:00:00Z',
    forecast_hours: [0, 6, 12, 24, 30, 36, 42, 48],
    status: 'complete',
    created_at: '2024-01-15T01:15:00Z',
  },
]

export const MOCK_POINT_METRICS = [
  {
    id: 'c1d2e3f4-a5b6-7890-abcd-ef1234567890',
    run_a_id: 'r1a2b3c4-d5e6-7890-abcd-ef1234567890',
    run_b_id: 'r2a2b3c4-d5e6-7890-abcd-ef1234567890',
    variable: 'precip',
    lat: 40.71,
    lon: -74.01,
    lead_hour: 0,
    rmse: 1.5,
    bias: -0.5,
    spread: 2.0,
    created_at: '2024-01-15T01:30:00Z',
  },
  {
    id: 'c2d3e4f5-a5b6-7890-abcd-ef1234567891',
    run_a_id: 'r1a2b3c4-d5e6-7890-abcd-ef1234567890',
    run_b_id: 'r2a2b3c4-d5e6-7890-abcd-ef1234567890',
    variable: 'precip',
    lat: 40.71,
    lon: -74.01,
    lead_hour: 24,
    rmse: 2.5,
    bias: -1.0,
    spread: 3.5,
    created_at: '2024-01-15T01:30:00Z',
  },
]

export const MOCK_GRID = {
  variable: 'precip',
  lead_hour: 0,
  init_time: '2024-01-15T00:00:00Z',
  latitudes: [35.0, 35.25, 35.5],
  longitudes: [-80.0, -79.75, -79.5],
  values: [
    [1.5, 2.0, 1.8],
    [2.1, 2.5, 2.3],
    [1.9, 2.2, 2.6],
  ],
  bbox: { min_lat: 35.0, max_lat: 35.5, min_lon: -80.0, max_lon: -79.5 },
}

export const MOCK_VARIABLES = {
  precip: 'Total precipitation',
  wind_speed: '10m wind speed',
  mslp: 'Mean sea-level pressure',
  hgt_500: '500mb geopotential height',
}

export const MOCK_MONITOR_POINTS = [
  { lat: 40.7128, lon: -74.006, label: 'New York' },
  { lat: 34.0522, lon: -118.2437, label: 'Los Angeles' },
  { lat: 41.8781, lon: -87.6298, label: 'Chicago' },
  { lat: 29.7604, lon: -95.3698, label: 'Houston' },
  { lat: 47.6062, lon: -122.3321, label: 'Seattle' },
  { lat: 39.7392, lon: -104.9903, label: 'Denver' },
  { lat: 25.7617, lon: -80.1918, label: 'Miami' },
  { lat: 38.9072, lon: -77.0369, label: 'Washington DC' },
  { lat: 33.749, lon: -84.388, label: 'Atlanta' },
  { lat: 42.3601, lon: -71.0589, label: 'Boston' },
  { lat: 44.9778, lon: -93.265, label: 'Minneapolis' },
  { lat: 33.4484, lon: -112.074, label: 'Phoenix' },
  { lat: 37.7749, lon: -122.4194, label: 'San Francisco' },
  { lat: 32.7767, lon: -96.797, label: 'Dallas' },
  { lat: 45.5155, lon: -122.6789, label: 'Portland' },
  { lat: 42.3314, lon: -83.0458, label: 'Detroit' },
  { lat: 36.1627, lon: -86.7816, label: 'Nashville' },
  { lat: 39.9612, lon: -82.9988, label: 'Columbus' },
  { lat: 35.2271, lon: -80.8431, label: 'Charlotte' },
  { lat: 32.7157, lon: -117.1611, label: 'San Diego' },
]

export const MOCK_REGIONAL = [
  { lat: 40.7128, lon: -74.006, label: 'New York', spread: 2.5, rmse: 1.8, bias: 0.3 },
  { lat: 34.0522, lon: -118.2437, label: 'Los Angeles', spread: 1.2, rmse: 0.9, bias: -0.1 },
]

export const MOCK_DECOMPOSITION = [
  {
    lead_hour: 0,
    total_spread: 2.0,
    pairs: [
      { model_a: 'GFS', model_b: 'NAM', rmse: 1.2, bias: -0.3 },
      { model_a: 'GFS', model_b: 'ECMWF', rmse: 2.1, bias: 0.8 },
      { model_a: 'NAM', model_b: 'ECMWF', rmse: 1.8, bias: 0.5 },
    ],
  },
  {
    lead_hour: 24,
    total_spread: 3.5,
    pairs: [
      { model_a: 'GFS', model_b: 'NAM', rmse: 1.8, bias: -0.5 },
      { model_a: 'GFS', model_b: 'ECMWF', rmse: 3.0, bias: 1.2 },
      { model_a: 'NAM', model_b: 'ECMWF', rmse: 2.5, bias: 0.7 },
    ],
  },
]

export const MOCK_ALERT_RULES = [
  {
    id: 'rule-1-uuid',
    variable: 'precip',
    lat: 40.7128,
    lon: -74.006,
    location_label: 'New York',
    metric: 'spread',
    threshold: 5.0,
    comparison: 'gt',
    consecutive_hours: 1,
    enabled: true,
    created_at: '2024-01-15T00:00:00Z',
  },
]

export const MOCK_ALERT_EVENTS: object[] = []

// ---------------------------------------------------------------------------
// Route setup helper
// ---------------------------------------------------------------------------

export interface RouteOverrides {
  summaries?: object[]
  runs?: object[]
  pointMetrics?: object[]
  grid?: object | null
}

/**
 * Intercept all backend API routes and return mock JSON responses.
 * Individual routes can be overridden via the `overrides` argument.
 *
 * Call this before navigating so all requests from the first paint are mocked.
 */
export async function mockApiRoutes(page: Page, overrides: RouteOverrides = {}) {
  const summaries = 'summaries' in overrides ? overrides.summaries : MOCK_SUMMARIES
  const runs = 'runs' in overrides ? overrides.runs : MOCK_RUNS
  const pointMetrics = 'pointMetrics' in overrides ? overrides.pointMetrics : MOCK_POINT_METRICS
  const grid = 'grid' in overrides ? overrides.grid : MOCK_GRID

  // Health check
  await page.route(/\/api\/health/, route =>
    route.fulfill({ json: { status: 'ok' } }),
  )

  // Variables list
  await page.route(/\/api\/variables/, route =>
    route.fulfill({ json: MOCK_VARIABLES }),
  )

  // Monitor points (must be before /api/runs catch-all)
  await page.route(/\/api\/monitor-points/, route =>
    route.fulfill({ json: MOCK_MONITOR_POINTS }),
  )

  // Model run metrics (specific — must be before /api/runs catch-all)
  await page.route(/\/api\/runs\/[^/]+\/metrics/, route =>
    route.fulfill({ json: pointMetrics }),
  )

  // Model runs
  await page.route(/\/api\/runs/, route =>
    route.fulfill({ json: runs }),
  )

  // Divergence summary
  await page.route(/\/api\/divergence\/summary/, route =>
    route.fulfill({ json: summaries }),
  )

  // Decomposition
  await page.route(/\/api\/divergence\/decomposition/, route =>
    route.fulfill({ json: MOCK_DECOMPOSITION }),
  )

  // Regional divergence
  await page.route(/\/api\/divergence\/regional/, route =>
    route.fulfill({ json: MOCK_REGIONAL }),
  )

  // Point-level divergence metrics
  await page.route(/\/api\/divergence\/point/, route =>
    route.fulfill({ json: pointMetrics }),
  )

  // Grid snapshots list (more specific – registered after grid so it wins)
  await page.route(/\/api\/divergence\/grid\/snapshots/, route =>
    route.fulfill({ json: [] }),
  )

  // Grid divergence data (registered first; snapshots route above takes
  // priority for /grid/snapshots requests because of LIFO matching)
  await page.route(/\/api\/divergence\/grid$/, route => {
    if (grid == null) {
      return route.fulfill({ status: 404, json: { detail: 'No grid divergence data found' } })
    }
    return route.fulfill({ json: grid })
  })

  // Fallback: catch any remaining grid queries
  await page.route(/\/api\/divergence\/grid\?/, route => {
    if (grid == null) {
      return route.fulfill({ status: 404, json: { detail: 'No grid divergence data found' } })
    }
    return route.fulfill({ json: grid })
  })

  // Divergence history (sparklines)
  await page.route(/\/api\/divergence\/history/, route =>
    route.fulfill({ json: { variable: 'precip', points: [] } }),
  )

  // Model values (outlook)
  await page.route(/\/api\/divergence\/model-values/, route =>
    route.fulfill({ json: [] }),
  )

  // Verification scores
  await page.route(/\/api\/verification\/scores/, route =>
    route.fulfill({ json: { variable: 'precip', lat: 40.71, lon: -74.01, scores: [] } }),
  )

  // Alert rules
  await page.route(/\/api\/alerts\/rules/, route =>
    route.fulfill({ json: MOCK_ALERT_RULES }),
  )

  // Alert events
  await page.route(/\/api\/alerts\/events/, route =>
    route.fulfill({ json: MOCK_ALERT_EVENTS }),
  )
}
