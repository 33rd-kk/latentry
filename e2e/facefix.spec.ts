// Fix faces on the mock A1111 web UI: the source's Faces mode sends the
// picture and the face fix options, and with no face detector downloaded
// the run is refused before it starts, pointing to Setup. (The detection and
// the redraw are checked in __tests__/facefix.verify.ts: E2E downloads no model.)

import { expect, test, type Page, type Request } from '@playwright/test'
import sharp from 'sharp'

const generateButton = (page: Page) => page.getByRole('button', { name: 'Generate', exact: true })

test('Faces sends the face fix options, and without a detector says to download one on Setup', async ({ page }) => {
  await page.goto('/')
  await expect(generateButton(page)).toBeEnabled()
  const picture = await sharp({ create: { width: 64, height: 96, channels: 3, background: '#557799' } }).png().toBuffer()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /Drop an image or click to choose/ }).click()
  await (await chooser).setFiles({ name: 'source.png', mimeType: 'image/png', buffer: picture })

  await page.getByRole('radio', { name: 'Faces' }).click()
  await expect(page.getByRole('radio', { name: 'Faces' })).toBeChecked()
  await page.getByRole('radio', { name: 'Photos' }).click()
  await page.getByLabel('Face prompt').fill('detailed face')
  await expect(page.getByRole('link', { name: 'Face detectors on Setup' })).toHaveAttribute('href', '/setup#face-detectors')

  await page.locator('#prompt').fill(`facefix spec ${Date.now()}`)
  const sent = page.waitForRequest((request: Request) => request.method() === 'POST' && request.url().endsWith('/generate'))
  await generateButton(page).click()
  const body = (await sent).postDataJSON() as Record<string, unknown>
  expect(typeof body.init_image_base64).toBe('string')
  expect(body.facefix).toEqual({ detector: 'photo', confidence: 0.6, maxFaces: 4, denoise: 0.4, prompt: 'detailed face' })
  expect(body.strength).toBeUndefined()
  await expect(page.getByText('Download this face detector on Setup first.')).toBeVisible()
})
