// The generate form's "Show" row: a hidden block leaves the form, is not sent,
// keeps what it holds for when it is shown again, and the browser remembers
// which ones are hidden.

import { expect, test, type Page, type Request } from '@playwright/test'
import sharp from 'sharp'

const generateButton = (page: Page) => page.getByRole('button', { name: 'Generate', exact: true })
const shows = (page: Page) => page.getByRole('group', { name: 'Show' })
const block = (page: Page, name: string) => shows(page).getByRole('button', { name: new RegExp(`^${name}`) })
const dropZone = (page: Page) => page.getByRole('button', { name: /Drop an image or click to choose/ })

/** Generates, and returns what the page sent once the run has ended. */
async function generate(page: Page, prompt: string): Promise<Record<string, unknown>> {
  await page.locator('#prompt').fill(prompt)
  const sent = page.waitForRequest((request: Request) => request.method() === 'POST' && request.url().endsWith('/generate'))
  await generateButton(page).click()
  const body = (await sent).postDataJSON() as Record<string, unknown>
  await expect(page.getByRole('link', { name: 'In gallery' })).toBeVisible()
  return body
}

test('a hidden source image is not sent, and is still there when shown again', async ({ page }) => {
  await page.goto('/')
  await expect(generateButton(page)).toBeEnabled()
  await expect(block(page, 'Source image')).toHaveAttribute('aria-pressed', 'true')

  const picture = await sharp({ create: { width: 64, height: 96, channels: 3, background: '#557799' } }).png().toBuffer()
  const chooser = page.waitForEvent('filechooser')
  await dropZone(page).click()
  await (await chooser).setFiles({ name: 'source.png', mimeType: 'image/png', buffer: picture })
  await expect(page.getByRole('radio', { name: 'Variation / edit' })).toBeChecked()

  await block(page, 'Source image').click()
  await expect(block(page, 'Source image')).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('radio', { name: 'Variation / edit' })).toHaveCount(0)
  // Marked as holding something, so it is not forgotten.
  await expect(block(page, 'Source image').getByRole('img', { name: /^Hidden, so not used/ })).toBeVisible()

  const body = await generate(page, `blocks spec hidden source ${Date.now()}`)
  expect(body.init_image_base64).toBeUndefined()
  expect(body.strength).toBeUndefined()

  await block(page, 'Source image').click()
  await expect(page.getByRole('radio', { name: 'Variation / edit' })).toBeChecked()
  await expect(block(page, 'Source image').getByRole('img')).toHaveCount(0)
})

test('the hidden blocks are remembered after a reload', async ({ page }) => {
  await page.goto('/')
  await expect(generateButton(page)).toBeEnabled()
  await expect(page.getByRole('combobox', { name: 'Saved characters' })).toBeVisible()
  await block(page, 'Characters').click()
  await block(page, 'X/Y grid').click()
  await expect(page.getByRole('combobox', { name: 'Saved characters' })).toHaveCount(0)

  await page.reload()
  await expect(generateButton(page)).toBeEnabled()
  await expect(block(page, 'Characters')).toHaveAttribute('aria-pressed', 'false')
  await expect(block(page, 'X/Y grid')).toHaveAttribute('aria-pressed', 'false')
  await expect(block(page, 'Source image')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('combobox', { name: 'Saved characters' })).toHaveCount(0)
  await expect(dropZone(page)).toBeVisible()
})
