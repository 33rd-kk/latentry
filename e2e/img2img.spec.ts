// A source picture on the mock A1111 web UI: what the page sends for a
// variation and for an inpaint, and what the saved picture says it was.
// generate.md's own checks (docs-generate.spec.ts) look at the controls; this
// one follows a run through to the gallery.

import { expect, test, type Page, type Request } from '@playwright/test'
import sharp from 'sharp'

const generateButton = (page: Page) => page.getByRole('button', { name: 'Generate', exact: true })

async function withSource(page: Page) {
  await page.goto('/')
  await expect(generateButton(page)).toBeEnabled()
  const picture = await sharp({ create: { width: 64, height: 96, channels: 3, background: '#557799' } }).png().toBuffer()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /Drop an image or click to choose/ }).click()
  await (await chooser).setFiles({ name: 'source.png', mimeType: 'image/png', buffer: picture })
  await expect(page.getByRole('radio', { name: 'Variation / edit' })).toBeChecked()
}

/** Generates, and returns what the page sent once it is saved. */
async function generate(page: Page, prompt: string): Promise<Record<string, unknown>> {
  await page.locator('#prompt').fill(prompt)
  const sent = page.waitForRequest((request: Request) => request.method() === 'POST' && request.url().endsWith('/generate'))
  await generateButton(page).click()
  const body = (await sent).postDataJSON() as Record<string, unknown>
  await expect(page.getByRole('link', { name: 'In gallery' })).toBeVisible()
  return body
}

/** Opens the saved picture with this prompt in the viewer, its panel shown; returns the value next to a label there. */
async function openSaved(page: Page, prompt: string) {
  await page.goto('/gallery')
  await page.getByPlaceholder('Search prompts, tags, models, file names').fill(prompt)
  const thumbs = page.locator('img[src^="/api/gallery/0/"][src*="thumb=1"]')
  await expect(thumbs).toHaveCount(1)
  await thumbs.first().click()
  const useSettings = page.getByRole('button', { name: 'Generate with these settings' })
  if (!(await useSettings.isVisible())) await page.getByRole('button', { name: 'Details' }).click()
  await expect(useSettings).toBeVisible()
  return (label: string) => page.locator('dt', { hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd[1]')
}

test('a variation sends the source and its strength, and the picture records both', async ({ page }) => {
  const prompt = `img2img spec variation ${Date.now()}`
  await withSource(page)
  const strength = Number((await page.getByText(/^Strength: [\d.]+$/).textContent())!.replace('Strength: ', ''))
  const body = await generate(page, prompt)
  expect(typeof body.init_image_base64).toBe('string')
  expect(body.strength).toBe(strength)
  expect(body.mask_base64).toBeUndefined()

  const fact = await openSaved(page, prompt)
  await expect(fact('Mode')).toHaveText('img2img')
  await expect(fact('Strength')).toHaveText(String(strength))
})

test('a painted mask is sent with the source, and the picture is an inpaint', async ({ page }) => {
  const prompt = `img2img spec inpaint ${Date.now()}`
  await withSource(page)
  await page.getByRole('button', { name: 'Draw mask' }).click()
  // The mask is painted on the canvas laid over the source picture.
  const canvas = page.locator('img[alt="Source image (img2img)"] + canvas')
  // Taller than the window: bring its top into view and paint a stroke below
  // the sticky header, which covers the window's top edge.
  await canvas.evaluate((element) => element.scrollIntoView({ block: 'start' }))
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width * 0.3, box.y + 150)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.7, box.y + 300, { steps: 8 })
  await page.mouse.up()
  await expect(page.getByText('Mask set')).toBeVisible()

  const body = await generate(page, prompt)
  expect(typeof body.init_image_base64).toBe('string')
  expect(typeof body.mask_base64).toBe('string')

  const fact = await openSaved(page, prompt)
  await expect(fact('Mode')).toHaveText('inpaint')
})
