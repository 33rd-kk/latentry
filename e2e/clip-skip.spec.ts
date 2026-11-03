// guide/generate.md: CLIP skip on a backend that takes it (the mock ComfyUI's
// built-in graph), sent with the run, saved with the picture, and not shown
// once a workflow is chosen, since the workflow sets its own.

import { expect, test } from '@playwright/test'

test('CLIP skip is sent with the run and kept with the picture', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled()
  await page.getByRole('main').getByRole('combobox').first().click()
  await page.getByRole('option').filter({ hasText: 'comfyui' }).click()

  const clipSkip = page.getByRole('combobox', { name: 'CLIP skip' })
  await expect(clipSkip).toBeVisible()
  await clipSkip.click()
  await page.getByRole('option', { name: '2', exact: true }).click()

  await page.locator('#prompt').fill('clip skip spec lantern')
  const sent = page.waitForRequest((request) => request.url().endsWith('/generate') && request.method() === 'POST')
  await page.getByRole('button', { name: 'Generate', exact: true }).click()
  expect((await sent).postDataJSON().clip_skip).toBe(2)
  await expect(page.getByRole('link', { name: 'In gallery' })).toBeVisible()

  // In the gallery the picture says it.
  await page.goto('/gallery')
  await page.getByPlaceholder('Search prompts, tags, models, file names').fill('clip skip spec lantern')
  const thumbs = page.locator('img[src^="/api/gallery/0/"][src*="thumb=1"]')
  await expect(thumbs).toHaveCount(1)
  await thumbs.first().click()
  if (!(await page.getByRole('dialog').getByText('CLIP skip', { exact: true }).isVisible())) await page.getByRole('button', { name: 'Details' }).click()
  await expect(page.getByRole('dialog').getByText('CLIP skip', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')

  // A workflow sets its own: the field goes.
  await page.goto('/')
  await page.getByRole('main').getByRole('combobox').first().click()
  await page.getByRole('option').filter({ hasText: 'comfyui' }).click()
  await page.getByRole('combobox', { name: 'Workflow' }).click()
  await page.getByRole('option', { name: 'portrait', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'CLIP skip' })).toBeHidden()
})
