/**
 * E2E tests for the Time Series page.
 *
 * Verifies the filter controls (variable & location selects, custom
 * coordinate inputs, view mode toggle), the chart title that reflects
 * the current selection, and the empty-state message.
 */

import { expect, test } from '@playwright/test'
import { mockApiRoutes } from './helpers'

test.beforeEach(async ({ page }) => {
  await mockApiRoutes(page)
})

// ---------------------------------------------------------------------------
// Page structure
// ---------------------------------------------------------------------------

test('shows the page heading', async ({ page }) => {
  await page.goto('/timeseries')
  await expect(page.getByRole('heading', { name: 'Time Series Analysis' })).toBeVisible()
})

test('shows the subtitle', async ({ page }) => {
  await page.goto('/timeseries')
  await expect(page.getByText('Divergence metrics vs. forecast lead time')).toBeVisible()
})

// ---------------------------------------------------------------------------
// Variable select
// ---------------------------------------------------------------------------

test('variable dropdown is visible', async ({ page }) => {
  await page.goto('/timeseries')
  await expect(page.locator('label', { hasText: 'Variable' })).toBeVisible()
})

test('variable dropdown contains all four options', async ({ page }) => {
  await page.goto('/timeseries')
  const select = page.locator('select').first()
  for (const label of ['Precipitation', 'Wind Speed', 'Sea-Level Pressure', '500mb Heights']) {
    await expect(select.locator(`option >> text="${label}"`)).toBeAttached()
  }
})

test('variable dropdown defaults to Precipitation', async ({ page }) => {
  await page.goto('/timeseries')
  await expect(page.locator('select').first()).toHaveValue('precip')
})

// ---------------------------------------------------------------------------
// Location select
// ---------------------------------------------------------------------------

test('location dropdown is visible', async ({ page }) => {
  await page.goto('/timeseries')
  await expect(page.locator('label', { hasText: 'Location' })).toBeVisible()
})

test('location dropdown contains all twenty preset cities', async ({ page }) => {
  await page.goto('/timeseries')
  const locationSelect = page.locator('select').nth(1)
  for (const city of [
    'New York', 'Los Angeles', 'Chicago', 'Houston', 'Seattle', 'Denver', 'Miami', 'Washington DC',
    'Atlanta', 'Boston', 'Minneapolis', 'Phoenix', 'San Francisco', 'Dallas', 'Portland', 'Detroit',
    'Nashville', 'Columbus', 'Charlotte', 'San Diego',
  ]) {
    await expect(locationSelect.locator(`option >> text="${city}"`)).toBeAttached()
  }
})

test('location dropdown defaults to New York', async ({ page }) => {
  await page.goto('/timeseries')
  const locationSelect = page.locator('select').nth(1)
  const selected = await locationSelect.inputValue()
  expect(selected).toContain('40.7128')
})

// ---------------------------------------------------------------------------
// View mode toggle
// ---------------------------------------------------------------------------

test('view mode dropdown is visible with Aggregate and Decomposition options', async ({ page }) => {
  await page.goto('/timeseries')
  await expect(page.locator('label', { hasText: 'View' })).toBeVisible()
  const viewSelect = page.locator('label', { hasText: 'View' }).locator('..').locator('select')
  await expect(viewSelect.locator('option >> text="Aggregate"')).toBeAttached()
  await expect(viewSelect.locator('option >> text="Per-Pair Decomposition"')).toBeAttached()
})

test('switching to decomposition view updates chart heading', async ({ page }) => {
  await page.goto('/timeseries')
  const viewSelect = page.locator('label', { hasText: 'View' }).locator('..').locator('select')
  await viewSelect.selectOption('decomposition')
  await expect(page.getByText(/Per-Pair RMSE/)).toBeVisible()
})

// ---------------------------------------------------------------------------
// Chart title reflects current filters
// ---------------------------------------------------------------------------

test('chart heading shows the current location and variable', async ({ page }) => {
  await page.goto('/timeseries')
  // Default: New York / Precipitation
  await expect(page.getByText(/Divergence at New York — Precipitation/)).toBeVisible()
})

test('changing variable updates the chart heading', async ({ page }) => {
  await page.goto('/timeseries')
  await page.locator('select').first().selectOption('wind_speed')
  await expect(page.locator('h3').filter({ hasText: /Wind Speed/ })).toBeVisible()
})

test('changing location updates the chart heading', async ({ page }) => {
  await page.goto('/timeseries')
  const locationSelect = page.locator('select').nth(1)
  await locationSelect.selectOption({ label: 'Chicago' })
  await expect(page.getByText(/Divergence at Chicago/)).toBeVisible()
})

// ---------------------------------------------------------------------------
// Custom coordinate entry
// ---------------------------------------------------------------------------

test('custom lat/lon inputs and Go button are present', async ({ page }) => {
  await page.goto('/timeseries')
  await expect(page.locator('input[placeholder="40.71"]')).toBeVisible()
  await expect(page.locator('input[placeholder="-74.01"]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Go' })).toBeVisible()
})

test('entering custom coordinates and clicking Go updates the chart heading', async ({ page }) => {
  await page.goto('/timeseries')
  await page.locator('input[placeholder="40.71"]').fill('51.50')
  await page.locator('input[placeholder="-74.01"]').fill('-0.12')
  await page.getByRole('button', { name: 'Go' }).click()
  await expect(page.getByText(/51\.50, -0\.12/)).toBeVisible()
})

test('entering invalid coordinates does not crash the app', async ({ page }) => {
  await page.goto('/timeseries')
  await page.locator('input[placeholder="40.71"]').fill('not-a-number')
  await page.locator('input[placeholder="-74.01"]').fill('also-invalid')
  await page.getByRole('button', { name: 'Go' }).click()
  // App should still show the original location
  await expect(page.getByText(/Divergence at New York/)).toBeVisible()
})

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

test('shows empty-data message when API returns no metrics', async ({ page }) => {
  // Override the point-metrics route set up in beforeEach with an empty response
  await page.route(/\/api\/divergence\/point/, route => route.fulfill({ json: [] }))
  await page.goto('/timeseries')
  await expect(
    page.getByText('No data available for this location and variable.'),
  ).toBeVisible()
})
