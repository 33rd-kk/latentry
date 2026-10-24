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
  const menu = page.getByRole('combobox', { name: 'Language' })
  const button = (await menu.boundingBox())!
  await menu.click()
  const list = (await page.getByRole('listbox').boundingBox())!
  expect(list.y).toBeGreaterThanOrEqual(button.y + button.height - 1)
  expect(Math.abs(list.x + list.width - (button.x + button.width))).toBeLessThan(4)
  await page.getByRole('option', { name: 'English' }).click()
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
})
