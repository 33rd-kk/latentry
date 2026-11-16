// Small layout promises that only show with longer (Japanese) labels or a
// long page: the Generate page's choice rows keep every label inside the card,
// and the gallery offers a way back to its top once it has scrolled.

import { expect, test, type Locator, type Page } from './test'
import sharp from 'sharp'

test.use({ locale: 'ja-JP' })

const generateButton = (page: Page) => page.getByRole('button', { name: '生成', exact: true })

/** Every radio in the group shows its whole label, inside the card around it. */
async function expectAllInside(group: Locator) {
  const card = group.locator('xpath=ancestor::*[@data-slot="card"][1]')
  const box = (await card.boundingBox())!
  const radios = group.getByRole('radio')
  const count = await radios.count()
  expect(count).toBeGreaterThan(1)
  for (let i = 0; i < count; i++) {
    const radio = radios.nth(i)
    const fits = await radio.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
    expect(fits, `the label of ${await radio.textContent()} fits its button`).toBe(true)
    const own = (await radio.boundingBox())!
    expect(own.x).toBeGreaterThanOrEqual(box.x - 1)
    expect(own.x + own.width).toBeLessThanOrEqual(box.x + box.width + 1)
  }
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
  test(`the source and control choices fit their card at ${viewport.width} px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await expect(generateButton(page)).toBeEnabled()
    const picture = await sharp({ create: { width: 64, height: 96, channels: 3, background: '#557799' } }).png().toBuffer()
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: /画像をドロップするかクリックして選びます/ }).click()
    await (await chooser).setFiles({ name: 'source.png', mimeType: 'image/png', buffer: picture })
    const modes = page.getByRole('radiogroup', { name: '元画像の使い方' })
    await expect(modes.getByRole('radio', { name: 'バリエーション / 編集' })).toBeChecked()
    await expectAllInside(modes)

    // The control kinds, on the mock that lists all three.
    await page.getByRole('main').getByRole('combobox').first().click()
    await page.getByRole('option').filter({ has: page.getByText('pose', { exact: true }) }).click()
    await expect(page.getByRole('radio', { name: 'エッジ' })).toBeVisible()
    await expectAllInside(page.getByRole('radiogroup').filter({ has: page.getByRole('radio', { name: 'エッジ' }) }))
  })
}

test('a long gallery offers a way back to its top', async ({ page }) => {
  for (const n of [1, 2]) {
    await page.goto('/')
    await expect(generateButton(page)).toBeEnabled()
    await page.locator('#prompt').fill(`layout spec back to top ${n}`)
    const asked = page.waitForResponse((response) => response.url().endsWith('/generate') && response.request().method() === 'POST')
    await generateButton(page).click()
    await asked
    await expect(page.getByRole('link', { name: 'ギャラリーに保存済み' })).toBeVisible()
  }

  // A short window, so two pictures are more than a screen.
  await page.setViewportSize({ width: 390, height: 240 })
  await page.goto('/gallery')
  await expect(page.locator('img[src*="thumb=1"]').first()).toBeVisible()
  const back = page.getByRole('button', { name: '先頭へ戻る' })
  await expect(back).toHaveCount(0)

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect(back).toBeVisible()
  await back.click()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  await expect(back).toHaveCount(0)
  // Focus starts again at the top of the gallery, not in the search box.
  expect(await page.evaluate(() => document.activeElement?.getAttribute('role'))).not.toBe('combobox')
  expect(await page.evaluate(() => document.activeElement?.matches('[tabindex="-1"]'))).toBe(true)
})
