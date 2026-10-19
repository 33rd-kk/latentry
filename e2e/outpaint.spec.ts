// docs/guide/generate.md: Extend (outpainting). A source is chosen, the
// canvas grown on one side, and the run drawn on the mock A1111 web UI; the
// picture is saved with mode "outpaint".

import { expect, test } from '@playwright/test'
import sharp from 'sharp'

test('a source is extended on one side and drawn as one picture', async ({ page }) => {
  await page.goto('/')
  const generate = page.getByRole('button', { name: 'Generate', exact: true })
  await expect(generate).toBeEnabled()
  await page.locator('#prompt').fill('outpaintrun lighthouse, wide view')

  const picture = await sharp({ create: { width: 512, height: 512, channels: 3, background: '#557799' } }).png().toBuffer()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /Drop an image or click to choose/ }).click()
  await (await chooser).setFiles({ name: 'source.png', mimeType: 'image/png', buffer: picture })

  await page.getByRole('radio', { name: 'Extend' }).click()
  await expect(page.getByText('Strength: 1.00', { exact: true })).toBeVisible()
  await expect(page.getByText('New canvas: 512 × 512')).toBeVisible()

  // With nothing to grow, the run is not started.
  await generate.click()
  await expect(page.getByText('Nothing to extend')).toBeVisible()

  const left = page.getByRole('slider', { name: /^Left:/ })
  await left.focus()
  await left.press('PageUp')
  await left.press('PageUp')
  await expect(page.getByText('Left: 160px')).toBeVisible()
  await expect(page.getByText('New canvas: 672 × 512')).toBeVisible()

  await generate.click()
  await expect(page.locator('img[alt^="Generated image, seed"]')).toBeVisible()
  await expect(page.getByRole('link', { name: 'In gallery' })).toBeVisible()

  await page.goto('/gallery')
  await page.getByPlaceholder('Search prompts, tags, models, file names').fill('outpaintrun')
  const thumbs = page.locator('img[src^="/api/gallery/0/"][src*="thumb=1"]')
  await expect(thumbs).toHaveCount(1)
  await thumbs.first().click()
  const useSettings = page.getByRole('button', { name: 'Generate with these settings' })
  if (!(await useSettings.isVisible())) await page.getByRole('button', { name: 'Details' }).click()
  await expect(page.getByText('outpaint', { exact: true })).toBeVisible()
})
