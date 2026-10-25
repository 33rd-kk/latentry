// docs/guide/many.md: wildcards. The test run's settings point at a
// wildcards folder (scripts/e2e.mjs) with weather.txt ("light rain") and
// places/coast.txt ("rocky coast"): the picker puts one in, the run is drawn
// with its line, and the picture keeps the prompt as typed.

import { expect, test } from '@playwright/test'

test('a wildcard is picked, filled in for the run, and kept with the picture', async ({ page }) => {
  await page.goto('/')
  const generate = page.getByRole('button', { name: 'Generate', exact: true })
  await expect(generate).toBeEnabled()
  const prompt = page.locator('#prompt')
  await prompt.fill('wildcardrun lighthouse, __places/coast__')

  await page.getByRole('combobox', { name: 'Add a wildcard' }).click()
  await expect(page.getByRole('option')).toHaveText(['places/coast', 'weather'])
  await page.getByRole('option', { name: 'weather' }).click()
  await expect(prompt).toHaveValue('wildcardrun lighthouse, __places/coast__, __weather__')

  await generate.click()
  await expect(page.locator('img[alt^="Generated image, seed"]')).toBeVisible()
  await expect(page.getByRole('link', { name: 'In gallery' })).toBeVisible()

  await page.goto('/gallery')
  await page.getByPlaceholder('Search prompts, tags, models, file names').fill('wildcardrun')
  const thumbs = page.locator('img[src^="/api/gallery/0/"][src*="thumb=1"]')
  await expect(thumbs).toHaveCount(1)
  await thumbs.first().click()
  const useSettings = page.getByRole('button', { name: 'Generate with these settings' })
  if (!(await useSettings.isVisible())) await page.getByRole('button', { name: 'Details' }).click()
  await expect(page.getByText('rocky coast', { exact: true })).toBeVisible()
  await expect(page.getByText('light rain', { exact: true })).toBeVisible()
  await expect(page.getByText('wildcardrun lighthouse, __places/coast__, __weather__')).toBeVisible()
})

test('an unknown wildcard stops the run and says which', async ({ page }) => {
  await page.goto('/')
  const generate = page.getByRole('button', { name: 'Generate', exact: true })
  await expect(generate).toBeEnabled()
  await page.locator('#prompt').fill('lighthouse, __no such file__')
  const runs: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/generate')) runs.push(request.url())
  })
  await generate.click()
  await expect(page.getByText('There is no wildcard __no such file__ in the wildcards folder.')).toBeVisible()
  expect(runs, 'no run is started').toEqual([])
})

test('the wildcards folder is set on Settings', async ({ page }) => {
  await page.goto('/settings#wildcards')
  await expect(page.getByRole('tabpanel').getByText('Wildcards', { exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Wildcards folder' })).toHaveValue(/wildcards$/)
  await expect(page.getByRole('switch', { name: 'Use on paired devices' })).not.toBeChecked()
})
