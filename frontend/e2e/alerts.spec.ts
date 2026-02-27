/**
 * E2E tests for the Alerts page.
 *
 * Tests the alerts page navigation, rules table, and events table.
 */

import { expect, test } from '@playwright/test'
import { mockApiRoutes } from './helpers'

test.beforeEach(async ({ page }) => {
  await mockApiRoutes(page)
})

// ---------------------------------------------------------------------------
// Page structure
// ---------------------------------------------------------------------------

test('shows the alerts page heading', async ({ page }) => {
  await page.goto('/alerts')
  await expect(page.getByRole('heading', { name: 'Alerts' })).toBeVisible()
})

test('shows the subtitle', async ({ page }) => {
  await page.goto('/alerts')
  await expect(page.getByText('Configure alert rules and view triggered events.')).toBeVisible()
})

// ---------------------------------------------------------------------------
// Alert rules
// ---------------------------------------------------------------------------

test('shows alert rules section', async ({ page }) => {
  await page.goto('/alerts')
  await expect(page.locator('h3').filter({ hasText: 'Alert Rules' })).toBeVisible()
})

test('shows add rule button', async ({ page }) => {
  await page.goto('/alerts')
  await expect(page.getByRole('button', { name: 'Add Rule' })).toBeVisible()
})

test('clicking add rule shows the form', async ({ page }) => {
  await page.goto('/alerts')
  await page.getByRole('button', { name: 'Add Rule' }).click()
  await expect(page.getByRole('button', { name: 'Create' })).toBeVisible()
})

test('shows existing rule in the table', async ({ page }) => {
  await page.goto('/alerts')
  await expect(page.getByText('precip').first()).toBeVisible()
  await expect(page.getByText('New York').first()).toBeVisible()
  await expect(page.getByText('Enabled').first()).toBeVisible()
})

// ---------------------------------------------------------------------------
// Alert events
// ---------------------------------------------------------------------------

test('shows recent events section', async ({ page }) => {
  await page.goto('/alerts')
  await expect(page.getByText('Recent Events')).toBeVisible()
})

test('shows no events message when empty', async ({ page }) => {
  await page.goto('/alerts')
  await expect(page.getByText('No alert events.')).toBeVisible()
})

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

test('alerts link appears in the nav bar', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Alerts' })).toBeVisible()
})

test('clicking alerts nav link navigates to alerts page', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Alerts' }).click()
  await expect(page.getByRole('heading', { name: 'Alerts' })).toBeVisible()
})
