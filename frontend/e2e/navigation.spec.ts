/**
 * E2E tests for the top-level navigation bar and client-side routing.
 */

import { expect, test } from '@playwright/test'
import { mockApiRoutes } from './helpers'

test.beforeEach(async ({ page }) => {
  await mockApiRoutes(page)
})

// ---------------------------------------------------------------------------
// Navbar rendering
// ---------------------------------------------------------------------------

test('shows the app title in the navbar', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'SynopticSpread' })).toBeVisible()
})

test('navbar contains all three navigation links', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Divergence Map' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Time Series' })).toBeVisible()
})

// ---------------------------------------------------------------------------
// Active-link highlighting
// ---------------------------------------------------------------------------

test('Dashboard link is highlighted when on the root path', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Dashboard' })).toHaveClass(/text-blue-400/)
})

test('Divergence Map link is highlighted when on /map', async ({ page }) => {
  await page.goto('/map')
  await expect(page.getByRole('link', { name: 'Divergence Map' })).toHaveClass(/text-blue-400/)
  // Other links should not be active
  await expect(page.getByRole('link', { name: 'Dashboard' })).not.toHaveClass(/text-blue-400/)
})

test('Time Series link is highlighted when on /timeseries', async ({ page }) => {
  await page.goto('/timeseries')
  await expect(page.getByRole('link', { name: 'Time Series' })).toHaveClass(/text-blue-400/)
})

// ---------------------------------------------------------------------------
// Navigation via link clicks
// ---------------------------------------------------------------------------

test('clicking Divergence Map navigates to /map and loads the page', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Divergence Map' }).click()
  await expect(page).toHaveURL('/map')
  // Map page shows a variable control
  await expect(page.locator('select').first()).toBeVisible()
})

test('clicking Time Series navigates to /timeseries and loads the page', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Time Series' }).click()
  await expect(page).toHaveURL('/timeseries')
  await expect(page.getByRole('heading', { name: 'Time Series Analysis' })).toBeVisible()
})

test('clicking Dashboard from another page returns to /', async ({ page }) => {
  await page.goto('/timeseries')
  await page.getByRole('link', { name: 'Dashboard' }).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: 'Model Divergence Dashboard' })).toBeVisible()
})

// ---------------------------------------------------------------------------
// Direct navigation (deep link)
// ---------------------------------------------------------------------------

test('navigating directly to /map loads the Map page', async ({ page }) => {
  await page.goto('/map')
  await expect(page.locator('.leaflet-container')).toBeVisible()
})

test('navigating directly to /timeseries loads the Time Series page', async ({ page }) => {
  await page.goto('/timeseries')
  await expect(page.getByRole('heading', { name: 'Time Series Analysis' })).toBeVisible()
})
