// Upscale a picture from the gallery on the mock A1111 web UI: Generate opens
// in Upscale mode with the picture's own prompt, sends `upscale` with the
// hires fields, and the saved picture says it was an upscale.

import { expect, test } from '@playwright/test'

const PROMPT = 'a windmill by a river, upscale run'

test('a gallery picture is upscaled with its own prompt', async ({ page }) => {
  await page.goto('/')
  const generate = page.getByRole('button', { name: 'Generate', exact: true })
  await expect(generate).toBeEnabled()
  await page.locator('#prompt').fill(PROMPT)
  await generate.click()
  await expect(page.getByRole('link', { name: 'In gallery' })).toBeVisible()
  // Other words in the form: the upscale must bring the picture's own back.
  await page.locator('#prompt').fill('something else entirely')

  await page.goto('/gallery')
  await page.getByPlaceholder('Search prompts, tags, models, file names').fill(PROMPT)
  const thumbs = page.locator('img[src^="/api/gallery/0/"][src*="thumb=1"]')
  await expect(thumbs).toHaveCount(1)
  await thumbs.first().click()
  const upscale = page.getByRole('button', { name: 'Upscale', exact: true })
  if (!(await upscale.isVisible())) await page.getByRole('button', { name: 'Details' }).click()
  await upscale.click()

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('radio', { name: 'Upscale' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('#prompt')).toHaveValue(new RegExp(PROMPT.split(',')[0]))
  // The mock's picture is 64 x 96: twice that, and its latent modes are not offered.
  await expect(page.getByText(/^Upscale by: 2\.00 \(about 128×192\)$/)).toBeVisible()
  await page.getByRole('combobox').filter({ hasText: 'Lanczos' }).click()
  await expect(page.getByRole('option')).toHaveText(['Lanczos', 'R-ESRGAN 4x+'])
  await page.keyboard.press('Escape')

  const sent = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/generate'))
  await page.getByRole('button', { name: 'Generate', exact: true }).click()
  const body = (await sent).postDataJSON()
  expect([body.upscale, body.hr_scale, body.hr_upscaler, 'strength' in body, typeof body.init_image_base64]).toEqual([true, 2, 'Lanczos', false, 'string'])

  await expect(page.getByRole('link', { name: 'In gallery' })).toBeVisible()
  const listing = await page.request.get(`/api/gallery?dir=0&q=${encodeURIComponent(PROMPT)}`)
  const items = (await listing.json()).items as { meta?: { mode?: string; hires?: { scale: number }; width?: number } }[]
  const upscaled = items.find((item) => item.meta?.mode === 'upscale')
  expect(upscaled?.meta?.hires?.scale).toBe(2)
  // Recorded at its size before, as hires fix's first pass.
  expect(upscaled?.meta?.width).toBe(64)
})
