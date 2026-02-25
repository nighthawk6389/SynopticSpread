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
    num_points: 10,
    models_compared: ['GFS', 'NAM', 'ECMWF'],
    init_time: 'latest',
  },
  {
    variable: 'wind_speed',
    mean_spread: 0.87,
    max_spread: 2.34,
    num_points: 8,
    models_compared: ['GFS', 'NAM', 'ECMWF'],
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

  // Model runs  (register before divergence routes to avoid prefix conflicts)
  await page.route(/\/api\/runs/, route =>
    route.fulfill({ json: runs }),
  )

  // Divergence summary
  await page.route(/\/api\/divergence\/summary/, route =>
    route.fulfill({ json: summaries }),
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

  // Fallback: catch any remaining /api/ calls so none hit the real network
  await page.route(/\/api\/divergence\/grid\?/, route => {
    if (grid == null) {
      return route.fulfill({ status: 404, json: { detail: 'No grid divergence data found' } })
    }
    return route.fulfill({ json: grid })
  })
}
