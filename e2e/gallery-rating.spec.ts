// Stars in the gallery (guide/gallery.md#stars): given in the viewer, by
// mouse and keyboard, shown on the card, filtered and ordered by, and
// neither shown nor given in secret mode. Other tests save pictures to the
// same folder, so this one finds its own by searching for their prompts.

import { expect, test, type Page } from '@playwright/test'

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

/** The viewer's side panel, where the stars are: opened when it is not (it remembers being closed). */
async function stars(page: Page) {
  const group = page.getByRole('radiogroup', { name: 'Rating' })
  if (!(await group.isVisible())) await page.getByRole('button', { name: 'Details' }).click()
  await expect(group).toBeVisible()
  return group
}

function ratingSaved(page: Page, stars: number) {
  return page.waitForResponse(
    (response) => response.url().endsWith('/rating') && response.request().method() === 'PUT' && response.request().postDataJSON()?.stars === stars
  )
}

test('stars are given, shown, filtered and ordered by', async ({ page }) => {
  await generateOnce(page, 'rating spec lantern')
  await generateOnce(page, 'rating spec orchard')

  await page.goto('/gallery')
  const thumbs = page.locator('img[src^="/api/gallery/0/"][src*="thumb=1"]')
  await page.getByPlaceholder('Search prompts, tags, models, file names').fill('rating spec')
  await expect(thumbs).toHaveCount(2)

  // The newer one (orchard) comes first: give it 2 stars with the mouse.
  await thumbs.first().click()
  const rating = await stars(page)
  const saved = ratingSaved(page, 2)
  await rating.getByRole('radio', { name: '2 of 5 stars' }).click()
  expect((await saved).status()).toBe(200)
  await expect(rating.getByRole('radio', { name: '2 of 5 stars' })).toHaveAttribute('aria-checked', 'true')

  // The other one (lantern) gets 5 from the keyboard. (The arrows would move
  // the rating now, with a star focused: the viewer's button moves on.)
  await page.getByRole('button', { name: 'Next image' }).click()
  await expect(page.getByText(/rating spec lantern/).first()).toBeVisible()
  const five = ratingSaved(page, 5)
  await page.keyboard.press('5')
  expect((await five).status()).toBe(200)
  await expect(rating.getByRole('radio', { name: '5 of 5 stars' })).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('radiogroup', { name: 'Rating' })).toBeHidden()

  // Each card shows its stars.
  const badge = (title: string) => page.locator(`span[title="${title}"]`)
  await expect(badge('5 of 5 stars')).toBeVisible()
  await expect(badge('2 of 5 stars')).toBeVisible()

  // Most stars first.
  await page.getByRole('combobox', { name: 'Order' }).click()
  await page.getByRole('option', { name: 'Most stars first' }).click()
  await expect(thumbs.first()).toHaveAttribute('alt', /rating spec lantern/)

  // At least 3 stars: only the lantern.
  await page.getByRole('button', { name: /^Filters/ }).click()
  await page.getByRole('combobox', { name: 'Stars' }).click()
  await page.getByRole('option', { name: '3 or more' }).click()
  await expect(thumbs).toHaveCount(1)
  await expect(page.getByText('Stars: 3 or more')).toBeVisible()

  // Taking a rating away: choose the star it has.
  await thumbs.first().click()
  const again = await stars(page)
  const cleared = ratingSaved(page, 0)
  await again.getByRole('radio', { name: '5 of 5 stars' }).click()
  expect((await cleared).status()).toBe(200)
  await expect(again.getByRole('radio', { name: '5 of 5 stars' })).toHaveAttribute('aria-checked', 'false')
  await page.keyboard.press('Escape')
})

test('secret mode neither shows nor gives stars', async ({ page }) => {
  await generateOnce(page, 'rating spec secret')
  await page.goto('/gallery')
  const thumbs = page.locator('img[src^="/api/gallery/0/"][src*="thumb=1"]')
  await page.getByPlaceholder('Search prompts, tags, models, file names').fill('rating spec secret')
  await expect(thumbs).toHaveCount(1)
  await thumbs.first().click()
  const saved = ratingSaved(page, 4)
  await (await stars(page)).getByRole('radio', { name: '4 of 5 stars' }).click()
  await saved
  await page.keyboard.press('Escape')
  await expect(page.getByRole('radiogroup', { name: 'Rating' })).toBeHidden()
  const badge = page.locator('span[title="4 of 5 stars"]')
  await expect(badge).toBeVisible()

  await page.getByRole('button', { name: 'Secret mode' }).first().click()
  await expect(badge).toBeHidden()
  let sent = false
  page.on('request', (request) => {
    if (request.url().endsWith('/rating')) sent = true
  })
  await thumbs.first().click()
  await expect(page.getByRole('radiogroup', { name: 'Rating' })).toBeHidden()
  await page.keyboard.press('3')
  await page.keyboard.press('Escape')
  // Give a stray request time to show up before saying none went.
  await page.waitForTimeout(300)
  expect(sent).toBe(false)
  await page.getByRole('button', { name: 'Secret mode' }).first().click()
})
