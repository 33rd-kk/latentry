// The UI language: a browser set to Japanese gets the Japanese catalog on its
// first visit, and the header's language menu switches to English and keeps
// that choice after a reload. Every other spec runs in English (en-US).

import { expect, test } from '@playwright/test'

test.use({ locale: 'ja-JP' })

test('a Japanese browser gets Japanese, and the language menu switches to English', async ({ page }) => {
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: '設定', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'ギャラリー' })).toBeVisible()

  await page.getByRole('combobox', { name: 'Language' }).click()
  await page.getByRole('option', { name: 'English' }).click()
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
})
