// What docs/guide/gallery.md and secret-mode.md say about the gallery,
// checked on pictures from the mock A1111 web UI (64×96, seed 123). Other
// specs save pictures to the same folder, so each test finds its own by a
// word in their prompts.

import { expect, test, type Page } from '@playwright/test'

const thumbs = (page: Page) => page.locator('img[src^="/api/gallery/0/"][src*="thumb=1"]')
const search = (page: Page) => page.getByPlaceholder('Search prompts, tags, models, file names')

async function generateOnce(page: Page, prompt: string) {
  await page.goto('/')
  const generate = page.getByRole('button', { name: 'Generate', exact: true })
  await expect(generate).toBeEnabled()
  await page.locator('#prompt').fill(prompt)
  // The page may still show the last run (it picks one up on load) until
  // this one has been asked for.
  const asked = page.waitForResponse((response) => response.url().endsWith('/generate') && response.request().method() === 'POST')
  await generate.click()
  await asked
  await expect(page.getByRole('link', { name: 'In gallery' })).toBeVisible()
}

async function count(page: Page, q: string): Promise<number> {
  const response = await page.request.get(`/api/gallery?dir=0&q=${encodeURIComponent(q)}`)
  return ((await response.json()).items as unknown[]).length
}

// "Search": commas, quotes for an exact tag, a leading - to leave out,
// number keys, and x-ray / seed:-1 as plain text.
test('the search grammar works as the guide says', async ({ page }) => {
  await generateOnce(page, 'docsgrammar, very long hair, x-ray')
  await generateOnce(page, 'docsgrammar, long hair')

  expect(await count(page, 'docsgrammar')).toBe(2)
  expect(await count(page, 'docsgrammar, "long hair"')).toBe(1)
  expect(await count(page, 'docsgrammar, long_hair')).toBe(2)
  expect(await count(page, 'docsgrammar, LONG HAIR')).toBe(2)
  expect(await count(page, 'docsgrammar, -"long hair"')).toBe(1)
  expect(await count(page, 'docsgrammar, x-ray')).toBe(1)
  expect(await count(page, 'docsgrammar, seed:123')).toBe(2)
  expect(await count(page, 'docsgrammar, seed:-1')).toBe(0)
  expect(await count(page, 'docsgrammar, steps:>=1')).toBe(2)
  expect(await count(page, 'docsgrammar, steps:<1')).toBe(0)
  // "Width and height are the real size."
  expect(await count(page, 'docsgrammar, w:64, h:96')).toBe(2)

  await page.goto('/gallery')
  // The tips show under the box while it is in use, until hidden; then the
  // button next to the box brings them back.
  const tips = page.getByText(/^Commas separate terms/)
  await search(page).fill('docsgrammar')
  await expect(tips).toBeVisible()
  await page.getByRole('button', { name: 'Hide tips' }).click()
  await expect(tips).toBeHidden()
  await page.getByRole('button', { name: 'Show search tips' }).click()
  await expect(tips).toBeVisible()
})

// "Order": the menu's entries.
test('the order menu offers what the guide lists', async ({ page }) => {
  await page.goto('/gallery')
  await page.getByRole('combobox', { name: 'Order' }).click()
  await expect(page.getByRole('option')).toHaveText([
    'Newest first',
    'Oldest first',
    'Name A–Z',
    'Name Z–A',
    'Largest file first',
    'Made, newest first',
    'Made, oldest first',
    'Most pixels first',
    'Fewest pixels first',
  ])
})

// "Filters": each one shows as a chip with × (or Clear all); "they are not
// remembered in the browser".
test('a filter shows as a chip, clears, and is gone after a reload', async ({ page }) => {
  await generateOnce(page, 'docsfilter portrait')
  await page.goto('/gallery')
  await search(page).fill('docsfilter')
  await expect(thumbs(page)).toHaveCount(1)

  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  await page.getByRole('button', { name: 'Landscape', exact: true }).click()
  await expect(thumbs(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Filters (1)' })).toBeVisible()
  await page.getByRole('button', { name: 'Remove filter: Landscape' }).click()
  await expect(thumbs(page)).toHaveCount(1)

  // Clear all appears once two or more are set.
  await page.getByRole('button', { name: 'Portrait', exact: true }).click()
  await page.getByRole('button', { name: 'PNG', exact: true }).click()
  await expect(page.getByRole('button', { name: /^Remove filter: / })).toHaveCount(2)
  await expect(thumbs(page)).toHaveCount(1)
  await page.getByRole('button', { name: 'Clear all' }).click()
  await expect(page.getByRole('button', { name: /^Remove filter: / })).toHaveCount(0)

  await page.getByRole('button', { name: 'Portrait', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Filters (1)' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Filters', exact: true })).toBeVisible()
})

// "Stack": pictures that share a prompt go into one card that says how
// many; clicking it shows them, and removing the One stack chip goes back.
test('pictures with the same prompt stack, and the stack opens', async ({ page }) => {
  await generateOnce(page, 'docsstack same prompt')
  await generateOnce(page, 'docsstack same prompt')
  await page.goto('/gallery')
  await search(page).fill('docsstack')
  await expect(thumbs(page)).toHaveCount(2)

  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  await page.getByRole('combobox', { name: 'Stack' }).click()
  await page.getByRole('option', { name: 'Same prompt' }).click()
  await expect(thumbs(page)).toHaveCount(1)
  await expect(page.getByTitle('2 pictures. Click to see them all.')).toHaveText('2')
  await thumbs(page).first().click()
  const chip = page.getByRole('button', { name: /^Remove filter: One stack/ })
  await expect(chip).toBeVisible()
  await expect(thumbs(page)).toHaveCount(2)
  await chip.click()
  await expect(thumbs(page)).toHaveCount(1)
})

// "Compare": same shape, overlaid with a slider; settings that differ and
// the tags only one has.
test('two pictures of the same shape are overlaid with a slider', async ({ page }) => {
  await generateOnce(page, 'docscompare, red')
  await generateOnce(page, 'docscompare, blue')
  await page.goto('/gallery')
  await search(page).fill('docscompare')
  await expect(thumbs(page)).toHaveCount(2)
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  await page.getByRole('button', { name: 'Select all 2' }).click()
  await page.getByRole('button', { name: 'Compare', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Compare two pictures' })).toBeVisible()
  await expect(dialog.getByRole('slider')).toBeVisible()
  await expect(dialog.getByText(/^Only in A's prompt \(1\)$/)).toBeVisible()
  await expect(dialog.getByText(/^Only in B's prompt \(1\)$/)).toBeVisible()
})

// "Tags": +N shows the rest; Show less, a click outside, or Esc folds them.
test('tags under a card unfold and fold again', async ({ page }) => {
  const many = Array.from({ length: 24 }, (_, n) => `docstag${n}`).join(', ')
  await generateOnce(page, many)
  await page.goto('/gallery')
  await search(page).fill('docstag0')
  await expect(thumbs(page)).toHaveCount(1)
  await page.getByRole('button', { name: 'Tags', exact: true }).click()
  const more = page.getByRole('button', { name: /^\+\d+$/ })
  const less = page.getByRole('button', { name: 'Show less' })
  await expect(more).toBeVisible()
  await more.click()
  await expect(less).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(more).toBeVisible()
  await more.click()
  await less.click()
  await expect(more).toBeVisible()
  await more.click()
  await search(page).click()
  await expect(more).toBeVisible()
  await page.getByRole('button', { name: 'Tags', exact: true }).click()
})

// "The viewer": its panel's actions, and per section Copy all, All to
// positive and All to negative.
test("the viewer's panel has the actions the guide lists", async ({ page }) => {
  await generateOnce(page, 'docsviewer, lighthouse')
  await page.goto('/gallery')
  await search(page).fill('docsviewer')
  await expect(thumbs(page)).toHaveCount(1)
  await thumbs(page).first().click()
  const useSettings = page.getByRole('button', { name: 'Generate with these settings' })
  if (!(await useSettings.isVisible())) await page.getByRole('button', { name: 'Details' }).click()
  for (const name of ['Generate with these settings', 'Use as source', 'Use as pose reference', 'Upscale', 'Show in folder', 'Open in default app']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
  }
  for (const name of ['Copy all', 'All to positive', 'All to negative']) await expect(page.getByRole('button', { name }).first()).toBeVisible()
  for (const label of ['Backend', 'Seed', 'Size', 'Steps']) await expect(page.getByText(label, { exact: true }).first()).toBeVisible()
})
