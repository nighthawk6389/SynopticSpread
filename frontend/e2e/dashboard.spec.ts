/**
 * E2E tests for the Dashboard page.
 *
 * Tests both the empty-data state (API returns empty arrays) and the
 * populated state (API returns full mock data), verifying the summary cards
 * and the model-runs table render correctly from a user's perspective.
 */

import { expect, test } from '@playwright/test'
import { MOCK_RUNS, MOCK_SUMMARIES, mockApiRoutes } from './helpers'

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

test.describe('Dashboard – empty state', () => {
  test.beforeEach(async ({ page }) => {
    await mockApiRoutes(page, { summaries: [], runs: [] })
    await page.goto('/')
  })

  test('shows the page heading', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: 'Model Divergence Dashboard' }),
    ).toBeVisible()
  })

  test('shows the subtitle', async ({ page }) => {
    await expect(
      page.getByText('Ensemble spread across GFS, NAM, and ECMWF'),
    ).toBeVisible()
  })

  test('shows the no-data message for divergence cards', async ({ page }) => {
    await expect(
      page.getByText('No divergence data yet. Trigger a model run from the admin panel.'),
    ).toBeVisible()
  })

  test('shows the no-data row in the model runs table', async ({ page }) => {
    await expect(page.getByText('No model runs yet.')).toBeVisible()
  })

  test('model runs table headers are still rendered', async ({ page }) => {
    await expect(page.locator('th').filter({ hasText: 'Model' })).toBeVisible()
    await expect(page.locator('th').filter({ hasText: 'Init Time' })).toBeVisible()
    await expect(page.locator('th').filter({ hasText: 'Status' })).toBeVisible()
    await expect(page.locator('th').filter({ hasText: 'Lead Hours' })).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// Populated state – summary cards
// ---------------------------------------------------------------------------

test.describe('Dashboard – summary cards', () => {
  test.beforeEach(async ({ page }) => {
    await mockApiRoutes(page)
    await page.goto('/')
  })

  test('renders a card for each variable in the API response', async ({ page }) => {
    await expect(page.getByText('Precipitation')).toBeVisible()
    await expect(page.getByText('Wind Speed')).toBeVisible()
  })

  test('shows the mean spread value on the card', async ({ page }) => {
    // precip mean_spread = 1.23
    await expect(page.getByText(/1\.23/).first()).toBeVisible()
  })

  test('shows the unit label (mm avg spread)', async ({ page }) => {
    await expect(page.getByText(/mm/).first()).toBeVisible()
    await expect(page.getByText(/avg ensemble spread/).first()).toBeVisible()
  })

  test('shows min, avg, and max spread', async ({ page }) => {
    const precip = MOCK_SUMMARIES[0]
    await expect(page.getByText('Min').first()).toBeVisible()
    await expect(page.getByText('Max').first()).toBeVisible()
    await expect(page.getByText(precip.max_spread.toFixed(2))).toBeVisible()
  })

  test('shows number of data points', async ({ page }) => {
    const precip = MOCK_SUMMARIES[0]
    await expect(page.getByText(new RegExp(`${precip.num_points} data points`))).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// Populated state – model runs table
// ---------------------------------------------------------------------------

test.describe('Dashboard – model runs table', () => {
  test.beforeEach(async ({ page }) => {
    await mockApiRoutes(page)
    await page.goto('/')
  })

  test('shows all model names', async ({ page }) => {
    await expect(page.getByRole('cell', { name: 'GFS' })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'NAM' })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'ECMWF' })).toBeVisible()
  })

  test('renders the GFS init time', async ({ page }) => {
    await expect(page.getByText(/15 Jan 2024/).first()).toBeVisible()
  })

  test('complete status has a green badge', async ({ page }) => {
    await expect(page.getByText('complete')).toHaveClass(/bg-green-900/)
  })

  test('pending status has a yellow badge', async ({ page }) => {
    await expect(page.getByText('pending')).toHaveClass(/bg-yellow-900/)
  })

  test('error status has a red badge', async ({ page }) => {
    await expect(page.getByText('error')).toHaveClass(/bg-red-900/)
  })

  test('shows forecast hour range for GFS', async ({ page }) => {
    const gfs = MOCK_RUNS[0]
    const first = gfs.forecast_hours[0]
    const last = gfs.forecast_hours[gfs.forecast_hours.length - 1]
    await expect(page.getByText(new RegExp(`${first}h .+ ${last}h`))).toBeVisible()
  })

  test('shows a dash for a run with no forecast hours', async ({ page }) => {
    await mockApiRoutes(page, {
      runs: [{ ...MOCK_RUNS[0], forecast_hours: [] }],
    })
    await page.goto('/')
    // em-dash "—"
    await expect(page.getByRole('cell', { name: '—' })).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// Location filter
// ---------------------------------------------------------------------------

test.describe('Dashboard – location filter', () => {
  test.beforeEach(async ({ page }) => {
    await mockApiRoutes(page)
    await page.goto('/')
  })

  test('location dropdown is visible with All Locations default', async ({ page }) => {
    await expect(page.locator('select').filter({ hasText: 'All Locations' })).toBeVisible()
  })
})
