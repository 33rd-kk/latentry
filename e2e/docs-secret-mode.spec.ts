// What docs/guide/secret-mode.md and threat-model.md say secret mode does,
// checked on the mock A1111 web UI. Secret mode is per browser, so each test
// has its own; turning it on is done through the header's eye.

import { expect, test, type Page } from '@playwright/test'

const toggle = (page: Page) => page.getByRole('button', { name: 'Secret mode' }).first()

async function secretOn(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled()
  await toggle(page).click()
  // "a filled Secret pill with a crossed-out eye, on every page"
  await expect(toggle(page)).toContainText('Secret')
}

// "Pictures are still saved to the gallery folder" (and "The generate page
// blurs pictures too": Show results / Blur results).
test('a secret run is blurred on the page and still saved to the gallery', async ({ page }) => {
  await secretOn(page)
  const prompt = 'docssecret saved run'
  await page.locator('#prompt').fill(prompt)
  await page.getByRole('button', { name: 'Generate', exact: true }).click()
  await expect(page.getByText('Pictures blurred in secret mode.')).toBeVisible()
  await page.getByRole('button', { name: 'Show results' }).click()
  await expect(page.getByRole('button', { name: 'Blur results' })).toBeVisible()

  const listing = await page.request.get(`/api/gallery?dir=0&q=${encodeURIComponent(prompt)}`)
  expect(((await listing.json()).items as unknown[]).length).toBe(1)

  await page.goto('/gallery')
  await expect(toggle(page)).toContainText('Secret')
})

// "Characters saved in secret mode are temporary": marked so in the list,
// and gone once secret mode is off.
test('a character saved in secret mode is temporary', async ({ page }) => {
  await secretOn(page)
  await page.getByRole('button', { name: 'Save character' }).click()
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Docs secret character')
  await page.getByRole('textbox', { name: /^Tags that make the character/ }).fill('red hair')
  await expect(page.getByText(/^Secret mode: kept in this tab only/)).toBeVisible()
  await page.getByRole('button', { name: 'Save character' }).last().click()
  const characters = page.getByRole('combobox', { name: 'Saved characters' })
  await characters.click()
  await expect(page.getByRole('option', { name: /Docs secret character/ })).toContainText('temporary')
  await page.keyboard.press('Escape')
  await toggle(page).click()
  await expect(characters).toContainText('No saved characters')
})

// "Compare blurs both" and its button shows them.
test('compare in secret mode hides both until shown', async ({ page }) => {
  for (const prompt of ['docssecretcompare, a', 'docssecretcompare, b']) {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled()
    await page.locator('#prompt').fill(prompt)
    await page.getByRole('button', { name: 'Generate', exact: true }).click()
    await expect(page.getByRole('link', { name: 'In gallery' })).toBeVisible()
  }
  await page.goto('/gallery')
  await page.getByPlaceholder('Search prompts, tags, models, file names').fill('docssecretcompare')
  await expect(page.locator('img[src^="/api/gallery/0/"][src*="thumb=1"]')).toHaveCount(2)
  await toggle(page).click()
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  await page.getByRole('button', { name: 'Select all 2' }).click()
  await page.getByRole('button', { name: 'Compare', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Pictures, settings and tags hidden in secret mode.')).toBeVisible()
  await dialog.getByRole('button', { name: 'Show for this comparison' }).click()
  await expect(dialog.getByText(/^Only in A's prompt/)).toBeVisible()
})
