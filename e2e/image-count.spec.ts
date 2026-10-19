// docs/guide/generate.md: Image count draws several pictures in one run, on
// the mock A1111 web UI and on the mock diffusers-compatible server. Each one
// is shown, seeded one after another, and saved to the gallery.

import { expect, test, type Page } from '@playwright/test'

async function drawTwo(page: Page, backend: string, prompt: string) {
  await page.goto('/')
  const generate = page.getByRole('button', { name: 'Generate', exact: true })
  await expect(generate).toBeEnabled()
  if (backend !== 'mock') {
    // The backend select is the first one on the page.
    await page.getByRole('combobox').first().click()
    await page.getByRole('option').filter({ has: page.getByText(backend, { exact: true }) }).click()
    await expect(generate).toBeEnabled()
  }
  await page.locator('#prompt').fill(prompt)
  const count = page.getByRole('slider', { name: /^Image count/ })
  await count.focus()
  await count.press('ArrowRight')
  await expect(count).toHaveAttribute('aria-valuenow', '2')
  await expect(page.getByText('Image count: 2')).toBeVisible()
  await generate.click()

  const results = page.locator('img[alt^="Generated image, seed"]')
  await expect(results).toHaveCount(2)
  await expect(page.getByRole('link', { name: 'In gallery' })).toHaveCount(2)
  const seeds = await results.evaluateAll((images) => images.map((image) => Number(image.getAttribute('alt')?.replace(/\D+/g, ''))))
  expect(seeds[1] - seeds[0], 'image i is seeded seed + i').toBe(1)

  await page.goto('/gallery')
  await page.getByPlaceholder('Search prompts, tags, models, file names').fill(prompt)
  await expect(page.locator('img[src^="/api/gallery/0/"][src*="thumb=1"]')).toHaveCount(2)
}

test('two pictures in one run on an A1111 web UI', async ({ page }) => {
  await drawTwo(page, 'mock', 'imagecounta1111 two lighthouses')
})

test('two pictures in one run on a diffusers-compatible server', async ({ page }) => {
  await drawTwo(page, 'pose', 'imagecountdiffusers two lighthouses')
})
