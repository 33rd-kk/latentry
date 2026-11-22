// Saved searches (guide/gallery.md#saved-searches): saved by name in this
// browser only, without the folder, applied again after a reload, renamed and
// deleted, and neither shown nor saved in secret mode. Other tests save
// pictures to the same folder, so this one searches for its own prompts.

import { expect, test, type Page } from './test'

const KEY = 'latentry:gallery-searches'
const thumbs = (page: Page) => page.locator('img[src^="/api/gallery/0/"][src*="thumb=1"]')
const search = (page: Page) => page.getByPlaceholder('Search prompts, tags, models, file names')
const savedButton = (page: Page) => page.getByRole('button', { name: 'Saved', exact: true })
const stored = (page: Page) => page.evaluate((key) => localStorage.getItem(key), KEY)

async function generateOnce(page: Page, prompt: string) {
  await page.goto('/')
  const generate = page.getByRole('button', { name: 'Generate', exact: true })
  await expect(generate).toBeEnabled()
  await page.locator('#prompt').fill(prompt)
  const asked = page.waitForResponse((response) => response.url().endsWith('/generate') && response.request().method() === 'POST')
  await generate.click()
  await asked
  await expect(page.getByRole('link', { name: 'In gallery' })).toBeVisible()
}

async function saveAs(page: Page, name: string) {
  await savedButton(page).click()
  await page.getByRole('menuitem', { name: 'Save this search…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Save this search' })
  await dialog.getByLabel('Name').fill(name)
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog).toBeHidden()
}

test('a search is saved by name, applied after a reload, renamed and deleted', async ({ page }) => {
  await generateOnce(page, 'savedspec harbor')
  await generateOnce(page, 'savedspec meadow')
  await page.goto('/gallery')

  // Nothing to save yet: no words, no filters.
  await savedButton(page).click()
  await expect(page.getByText('No saved searches yet.')).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Save this search…' })).toHaveAttribute('aria-disabled', 'true')
  await page.keyboard.press('Escape')

  await search(page).fill('savedspec harbor')
  await page.keyboard.press('Escape')
  await expect(thumbs(page)).toHaveCount(1)
  // The dialog offers the words as the name.
  await savedButton(page).click()
  await page.getByRole('menuitem', { name: 'Save this search…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Save this search' })
  await expect(dialog.getByLabel('Name')).toHaveValue('savedspec harbor')
  await expect(dialog.getByText('Kept in this browser only')).toBeVisible()
  await dialog.getByLabel('Name').fill('Harbor')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog).toBeHidden()

  // In this browser, with the words and no folder.
  const saved = JSON.parse((await stored(page))!)
  expect(saved.version).toBe(1)
  expect(saved.searches).toHaveLength(1)
  expect(saved.searches[0].name).toBe('Harbor')
  expect(saved.searches[0].params).toBe('q=savedspec+harbor')

  // After a reload the page starts empty, and the saved search brings it back.
  await page.reload()
  await expect(search(page)).toHaveValue('')
  await savedButton(page).click()
  await page.getByRole('menuitemradio', { name: 'Harbor' }).click()
  await expect(search(page)).toHaveValue('savedspec harbor')
  await expect(thumbs(page)).toHaveCount(1)
  await savedButton(page).click()
  await expect(page.getByRole('menuitemradio', { name: 'Harbor' })).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')

  // Rename, then delete: an empty list leaves nothing in the browser.
  await savedButton(page).click()
  await page.getByRole('menuitem', { name: 'Rename or delete…' }).click()
  const manage = page.getByRole('dialog', { name: 'Saved searches' })
  await manage.getByRole('button', { name: 'Rename Harbor' }).click()
  await manage.getByLabel('New name for Harbor').fill('Port')
  await manage.getByRole('button', { name: 'Rename', exact: true }).click()
  await expect(manage.getByText('Port', { exact: true })).toBeVisible()
  expect(JSON.parse((await stored(page))!).searches[0].name).toBe('Port')
  await manage.getByRole('button', { name: 'Delete Port' }).click()
  await expect(manage.getByText('No saved searches yet.')).toBeVisible()
  expect(await stored(page)).toBeNull()
})

test('saving the same name again replaces that search', async ({ page }) => {
  await page.goto('/gallery')
  await search(page).fill('savedspec one')
  await page.keyboard.press('Escape')
  await saveAs(page, 'Same')
  await search(page).fill('savedspec two')
  await page.keyboard.press('Escape')
  await savedButton(page).click()
  await page.getByRole('menuitem', { name: 'Save this search…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Save this search' })
  await dialog.getByLabel('Name').fill('same')
  await expect(dialog.getByText('A saved search has this name; saving replaces it.')).toBeVisible()
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  const saved = JSON.parse((await stored(page))!)
  expect(saved.searches).toEqual([expect.objectContaining({ name: 'same', params: 'q=savedspec+two' })])
})

test('secret mode neither shows nor saves searches', async ({ page }) => {
  await page.goto('/gallery')
  await search(page).fill('savedspec secret')
  await page.keyboard.press('Escape')
  await saveAs(page, 'Before secret')

  const toggle = page.getByRole('button', { name: 'Secret mode' }).first()
  await toggle.click()
  await expect(toggle).toContainText('Secret')
  await expect(savedButton(page)).toHaveCount(0)
  // Kept, unshown, and not changed while secret mode is on.
  const before = await stored(page)
  expect(before).toContain('Before secret')

  await toggle.click()
  await expect(toggle).not.toContainText('Secret')
  await savedButton(page).click()
  await expect(page.getByRole('menuitemradio', { name: 'Before secret' })).toBeVisible()
  expect(await stored(page)).toBe(before)
})
