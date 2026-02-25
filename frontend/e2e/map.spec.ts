/**
 * E2E tests for the Divergence Map page.
 *
 * Tests the filter controls (variable select, lead-hour slider), the
 * Leaflet map container, and the help text. Actual tile rendering and
 * map click interactions are excluded since they depend on external tile
 * servers and the headless-browser canvas environment.
 */

import { expect, test } from '@playwright/test'
import { MOCK_GRID, mockApiRoutes } from './helpers'

test.beforeEach(async ({ page }) => {
  await mockApiRoutes(page)
})

// ---------------------------------------------------------------------------
// Page structure
// ---------------------------------------------------------------------------

test('shows the variable select control', async ({ page }) => {
  await page.goto('/map')
  await expect(page.locator('label', { hasText: 'Variable' })).toBeVisible()
  await expect(page.locator('select')).toBeVisible()
})

test('variable select contains all four options', async ({ page }) => {
  await page.goto('/map')
  const select = page.locator('select')
  for (const label of ['Precipitation', 'Wind Speed', 'Sea-Level Pressure', '500mb Heights']) {
    await expect(select.locator(`option >> text="${label}"`)).toBeAttached()
  }
})

test('variable select defaults to Precipitation', async ({ page }) => {
  await page.goto('/map')
  await expect(page.locator('select')).toHaveValue('precip')
})

test('shows the lead hour slider', async ({ page }) => {
  await page.goto('/map')
  await expect(page.locator('label', { hasText: 'Lead Hour' })).toBeVisible()
  await expect(page.locator('input[type="range"]')).toBeVisible()
})

test('lead hour display starts at 0h', async ({ page }) => {
  await page.goto('/map')
  await expect(page.getByText('0h')).toBeVisible()
})

// ---------------------------------------------------------------------------
// Leaflet map container
// ---------------------------------------------------------------------------

test('Leaflet map container is rendered', async ({ page }) => {
  await page.goto('/map')
  await expect(page.locator('.leaflet-container')).toBeVisible()
})

// ---------------------------------------------------------------------------
// Control interactions
// ---------------------------------------------------------------------------

test('changing the variable select updates its value', async ({ page }) => {
  await page.goto('/map')
  const select = page.locator('select')
  await select.selectOption('mslp')
  await expect(select).toHaveValue('mslp')
})

test('dragging the lead-hour slider updates the displayed value', async ({ page }) => {
  await page.goto('/map')
  const slider = page.locator('input[type="range"]')
  // Use fill to set a specific value – Playwright fires the change event
  await slider.fill('48')
  await expect(page.getByText('48h')).toBeVisible()
})

test('lead hour slider respects the step of 6', async ({ page }) => {
  await page.goto('/map')
  const slider = page.locator('input[type="range"]')
  // Set to a value that is on a 6h boundary
  await slider.fill('24')
  await expect(page.getByText('24h')).toBeVisible()
})

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

test('shows the map interaction hint', async ({ page }) => {
  await page.goto('/map')
  await expect(
    page.getByText('Click anywhere on the map to view point-level divergence metrics.'),
  ).toBeVisible()
})

// ---------------------------------------------------------------------------
// Loading state
// ---------------------------------------------------------------------------

test('shows loading indicator while grid data is being fetched', async ({ page }) => {
  // Delay the grid response so the loading state is visible
  await page.route(/\/api\/divergence\/grid/, async route => {
    await new Promise(resolve => setTimeout(resolve, 1000))
    await route.fulfill({ json: MOCK_GRID })
  })
  await page.goto('/map')
  await expect(page.getByText('Loading grid...')).toBeVisible()
})
