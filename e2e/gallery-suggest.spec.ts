// guide/gallery.md, Search: suggestions in the search box. Tags of the
// pictures shown so far, settings by name, how to write a search; the note
// that says where tags come from; and in secret mode only how to search.

import { expect, test, type Page } from './test'

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

test('the search box suggests tags shown, settings and how to search', async ({ page }) => {
  const tag = `suggestspec${Date.now()}`
  await generateOnce(page, `${tag} lighthouse, ${tag} harbour`)
  await page.goto('/gallery')
  const box = page.getByRole('combobox', { name: /Search/ }).or(page.getByPlaceholder('Search prompts, tags, models, file names')).first()
  const list = page.getByRole('listbox', { name: 'Suggestions' })

  // Empty: how to write a search.
  await box.click()
  await expect(list).toBeVisible()
  await expect(list.getByRole('option', { name: /model:/ })).toBeVisible()
  await expect(list.getByRole('option', { name: /"…"/ })).toBeVisible()
  await expect(page.getByText(/Tags and names are suggested from the \d+ pictures shown so far only/)).toBeVisible()

  // A setting by name.
  await box.fill('mo')
  await expect(list.getByRole('option')).toHaveText([/^model:/])

  // A tag of a picture shown, taken with ↓ and Enter.
  await box.fill(`${tag} light`)
  const option = list.getByRole('option', { name: new RegExp(`${tag} lighthouse`) })
  await expect(option).toBeVisible()
  await box.press('ArrowDown')
  await expect(option).toHaveAttribute('aria-selected', 'true')
  await box.press('Enter')
  await expect(box).toHaveValue(`${tag} lighthouse, `)
  await box.press('Escape')
  await expect(list).toBeHidden()
  await expect(page.locator('img[src^="/api/gallery/0/"][src*="thumb=1"]')).toHaveCount(1)

  // Secret mode: no tags, still how to search, and the note says so.
  await page.getByRole('button', { name: 'Secret mode' }).first().click()
  await box.fill(`${tag} light`)
  await expect(list.getByRole('option')).toHaveCount(0)
  await box.fill('')
  await expect(list.getByRole('option', { name: /model:/ })).toBeVisible()
  await expect(page.getByText('Secret mode: no tags or names are suggested, only how to write a search.')).toBeVisible()
  await box.press('Escape')
  await page.getByRole('button', { name: 'Secret mode' }).first().click()
})
