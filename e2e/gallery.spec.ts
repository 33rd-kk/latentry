// The gallery's own controls: search, tags under the cards, and selecting
// pictures to compare or tag. Other tests save pictures to the same folder,
// so this one finds its own by searching for their prompts.

import { expect, test, type Page } from '@playwright/test'

async function generateOnce(page: Page, prompt: string) {
  await page.goto('/')
  const generate = page.getByRole('button', { name: 'Generate', exact: true })
  await expect(generate).toBeEnabled()
  await page.locator('#prompt').fill(prompt)
  await generate.click()
  await expect(page.getByRole('link', { name: 'In gallery' })).toBeVisible()
}

test('search, tags and selection in the gallery', async ({ page }) => {
  await generateOnce(page, 'gallery spec harbour')
  await generateOnce(page, 'gallery spec meadow')

  await page.goto('/gallery')
  const thumbs = page.locator('img[src^="/api/gallery/0/"][src*="thumb=1"]')
  const search = page.getByPlaceholder('Search prompts, tags, models, file names')

  await search.fill('gallery spec')
  await expect(thumbs).toHaveCount(2)
  await search.fill('gallery spec meadow')
  await expect(thumbs).toHaveCount(1)
  await search.fill('nothing-has-this-word')
  await expect(page.getByText(/No pictures here yet\.|Nothing matched in the files checked so far\./)).toBeVisible()
  await search.fill('gallery spec')
  await expect(thumbs).toHaveCount(2)

  const tags = page.getByRole('button', { name: 'Tags', exact: true })
  await expect(tags).toHaveAttribute('aria-pressed', 'false')
  await tags.click()
  await expect(tags).toHaveAttribute('aria-pressed', 'true')
  await tags.click()
  await expect(tags).toHaveAttribute('aria-pressed', 'false')

  const select = page.getByRole('button', { name: 'Select', exact: true })
  await select.click()
  await expect(select).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('0 selected')).toBeVisible()
  // The engine is off in these tests, so nothing can tag.
  await expect(page.getByText('No backend can tag pictures right now.')).toBeVisible()
  const compare = page.getByRole('button', { name: 'Compare', exact: true })
  await expect(compare).toBeDisabled()

  await page.getByRole('button', { name: 'Select all 2' }).click()
  await expect(page.getByText('2 selected')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Tag 2 with WD14' })).toBeDisabled()
  await expect(compare).toBeEnabled()
  await compare.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  // Another search names other pictures: the selection is dropped.
  await search.fill('gallery spec meadow')
  await expect(thumbs).toHaveCount(1)
  await expect(page.getByText('0 selected')).toBeVisible()

  await select.click()
  await expect(select).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByText(/\d+ selected/)).toBeHidden()
})
