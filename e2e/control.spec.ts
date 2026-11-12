// The Control block on a diffusers-compatible backend that lists control kinds
// (the mock in __tests__/fixtures/mock-diffusers.ts lists all three): a
// reference picture is turned into a control picture by Latentry
// (POST /api/control), shown, and sent with the run; the reference itself is
// not. Depth needs its model from Setup, which the E2E server has not got.

import { expect, test, type Page, type Request } from '@playwright/test'
import sharp from 'sharp'

const isControl = (request: Request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/control'
const isGenerate = (request: Request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/gen/pose/generate'

async function openBackend(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled()
  await page.getByRole('main').getByRole('combobox').first().click()
  await page.getByRole('option').filter({ has: page.getByText('pose', { exact: true }) }).click()
  await expect(page.getByRole('radio', { name: 'Edges' })).toBeVisible()
}

/** A picture with a light square on dark ground: Canny finds its edges. */
async function reference(): Promise<Buffer> {
  return sharp({ create: { width: 200, height: 160, channels: 3, background: '#202020' } })
    .composite([{ input: await sharp({ create: { width: 80, height: 60, channels: 3, background: '#e0e0e0' } }).png().toBuffer(), left: 60, top: 50 }])
    .png()
    .toBuffer()
}

test('a reference becomes an edges picture, which the run sends instead of the reference', async ({ page }) => {
  await openBackend(page)
  await expect(page.getByRole('radio', { name: 'Edges' })).toHaveAttribute('aria-checked', 'true')

  const chooser = page.waitForEvent('filechooser')
  const made = page.waitForResponse((response) => isControl(response.request()))
  await page.getByRole('button', { name: /Drop a reference picture/ }).click()
  await (await chooser).setFiles({ name: 'reference.png', mimeType: 'image/png', buffer: await reference() })
  const answer = await made
  expect(answer.status()).toBe(200)
  expect(answer.request().postDataJSON()).toMatchObject({ kind: 'canny' })
  await expect(page.getByRole('img', { name: 'The Edges control picture the run follows' })).toBeVisible()
  await expect(page.getByText('Control strength: 0.50')).toBeVisible()

  await page.getByRole('main').locator('#prompt').fill('a box on a table')
  const sent = page.waitForRequest(isGenerate)
  await page.getByRole('button', { name: 'Generate', exact: true }).click()
  const body = (await sent).postDataJSON() as Record<string, unknown>
  expect(body).toMatchObject({ control_kind: 'canny', control_strength: 0.5 })
  expect(String(body.control_image_base64)).toMatch(/^data:image\/png;base64,/)
  // The reference is never sent with the run: only the control picture made from it.
  expect(body).not.toHaveProperty('init_image_base64')
})

test('depth before its model is downloaded says where to get it, and nothing is sent', async ({ page }) => {
  await openBackend(page)
  await page.getByRole('radio', { name: 'Depth' }).click()
  const chooser = page.waitForEvent('filechooser')
  const made = page.waitForResponse((response) => isControl(response.request()))
  await page.getByRole('button', { name: /Drop a reference picture/ }).click()
  await (await chooser).setFiles({ name: 'reference.png', mimeType: 'image/png', buffer: await reference() })
  expect((await made).status()).toBe(409)
  await expect(page.getByText('Download the depth model on Setup first.')).toBeVisible()
  await expect(page.getByRole('img', { name: /control picture the run follows/ })).toHaveCount(0)

  await page.getByRole('main').locator('#prompt').fill('a room')
  const sent = page.waitForRequest(isGenerate)
  await page.getByRole('button', { name: 'Generate', exact: true }).click()
  expect((await sent).postDataJSON()).not.toHaveProperty('control_kind')
})

test('hidden from Show, the control picture is kept but not sent', async ({ page }) => {
  await openBackend(page)
  const chooser = page.waitForEvent('filechooser')
  const made = page.waitForResponse((response) => isControl(response.request()))
  await page.getByRole('button', { name: /Drop a reference picture/ }).click()
  await (await chooser).setFiles({ name: 'reference.png', mimeType: 'image/png', buffer: await reference() })
  await made
  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Control' }).click()
  await expect(page.getByRole('img', { name: /control picture the run follows/ })).toHaveCount(0)
  await page.getByRole('main').locator('#prompt').fill('a box')
  const sent = page.waitForRequest(isGenerate)
  await page.getByRole('button', { name: 'Generate', exact: true }).click()
  expect((await sent).postDataJSON()).not.toHaveProperty('control_kind')
  // Shown again, the same picture is back.
  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Control' }).click()
  await expect(page.getByRole('img', { name: 'The Edges control picture the run follows' })).toBeVisible()
})
