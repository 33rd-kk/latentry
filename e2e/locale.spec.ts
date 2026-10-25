// The UI language: a browser set to Japanese gets the Japanese catalog on its
// first visit, and the header's language menu switches to English and keeps
// that choice after a reload. Every other spec runs in English (en-US).

import { expect, test } from '@playwright/test'

test.use({ locale: 'ja-JP' })

test('a Japanese browser gets Japanese, and the language menu switches to English', async ({ page }) => {
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: '設定', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'ギャラリー' })).toBeVisible()

  // The list opens just below the button, its right edge at the button's. The
  // button is measured first: an open list hides the rest of the page from roles.
  // The list slides in, so its place is polled until it has arrived.
  const menu = page.getByRole('combobox', { name: 'Language' })
  const button = (await menu.boundingBox())!
  await menu.click()
  const list = async () => (await page.getByRole('listbox').boundingBox())!
  await expect.poll(async () => (await list()).y).toBeGreaterThanOrEqual(button.y + button.height - 1)
  await expect.poll(async () => Math.abs((await list()).x + (await list()).width - (button.x + button.width))).toBeLessThan(4)
  await page.getByRole('option', { name: 'English' }).click()
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
})

// The pairing page has no header, but a device that is not paired yet still
// needs to read its steps in its own language.
test('the pairing page has the language menu too', async ({ page }) => {
  await page.goto('/pair')
  await expect(page.getByText('この端末をペアリング')).toBeVisible()
  await page.getByRole('combobox', { name: 'Language' }).click()
  await page.getByRole('option', { name: 'English' }).click()
  await expect(page.getByText('Pair this device')).toBeVisible()
})
