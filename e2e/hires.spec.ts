// Hires fix on the mock A1111 web UI: off until switched on, then sent with
// the upscaler the backend lists, and written into the saved picture.

import { expect, test } from '@playwright/test'

const PROMPT = 'a castle on a hill, hires run'

test('hires fix is sent with the chosen upscaler and kept in the picture', async ({ page }) => {
  await page.goto('/')
  const generate = page.getByRole('button', { name: 'Generate', exact: true })
  await expect(generate).toBeEnabled()
  await page.locator('#prompt').fill(PROMPT)

  const hires = page.getByRole('switch', { name: 'Hires fix' })
  await expect(hires).not.toBeChecked()
  await expect(page.getByText('Upscaler', { exact: true })).toBeHidden()
  await hires.click()
  await expect(page.getByText(/^Upscale by: 2\.00 \(about \d+×\d+\)$/)).toBeVisible()

  // The backend's upscalers, "None" left out; Lanczos is picked to begin with.
  const upscaler = page.getByRole('combobox').filter({ hasText: 'Lanczos' })
  await upscaler.click()
  await expect(page.getByRole('option')).toHaveText(['Lanczos', 'R-ESRGAN 4x+', 'Latent'])
  await page.getByRole('option', { name: 'R-ESRGAN 4x+' }).click()

  const sent = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/generate'))
  await generate.click()
  const body = (await sent).postDataJSON()
  expect([body.hr_scale, body.hr_steps, body.hr_denoise, body.hr_upscaler]).toEqual([2, 0, 0.4, 'R-ESRGAN 4x+'])

  await expect(page.locator('img[alt^="Generated image, seed"]')).toBeVisible()
  await expect(page.getByRole('link', { name: 'In gallery' })).toBeVisible()

  // The saved picture's settings, as the gallery reads them back.
  const listing = await page.request.get(`/api/gallery?dir=0&q=${encodeURIComponent(PROMPT)}`)
  const items = (await listing.json()).items as { meta?: { hires?: unknown; strength?: unknown } }[]
  expect(items).toHaveLength(1)
  expect(items[0].meta?.hires).toEqual({ scale: 2, steps: 0, denoise: 0.4, upscaler: 'R-ESRGAN 4x+' })
  expect(items[0].meta?.strength).toBeUndefined()
  const meta = items[0].meta as { width?: number; height?: number }

  // The side panel: the file's own size, and the size it was drawn at beside it.
  await page.goto('/gallery')
  await page.getByPlaceholder('Search prompts, tags, models, file names').fill(PROMPT)
  const thumbs = page.locator('img[src^="/api/gallery/0/"][src*="thumb=1"]')
  await expect(thumbs).toHaveCount(1)
  await thumbs.first().click()
  const drawn = page.getByText('Drawn at', { exact: true })
  if (!(await page.getByRole('button', { name: 'Upscale', exact: true }).isVisible())) await page.getByRole('button', { name: 'Details' }).click()
  await expect(page.getByText('64×96', { exact: true })).toBeVisible()
  await expect(drawn).toBeVisible()
  await expect(page.getByText(`${meta.width}×${meta.height}`, { exact: true })).toBeVisible()
})
