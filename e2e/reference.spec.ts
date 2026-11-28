// The Reference block (IP-Adapter) on a diffusers-compatible backend that
// says ip_adapter: true (the mock in __tests__/fixtures/mock-diffusers.ts): a
// picture is chosen, shown, and sent with the run at its strength; hidden
// from Show it is kept but not sent. On the mock ComfyUI, which lists the
// IPAdapter_plus nodes and the two files scripts/e2e.mjs sets, it is offered
// and a run with it finishes.

import { expect, test, type Page, type Request } from './test'
import sharp from 'sharp'

const isGenerate = (request: Request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/gen/pose/generate'

async function openBackend(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled()
  await page.getByRole('main').getByRole('combobox').first().click()
  await page.getByRole('option').filter({ has: page.getByText('pose', { exact: true }) }).click()
  await expect(page.getByRole('button', { name: /Drop a picture whose look to take/ })).toBeVisible()
}

async function chooseReference(page: Page) {
  const picture = await sharp({ create: { width: 80, height: 60, channels: 3, background: '#cc6633' } }).png().toBuffer()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /Drop a picture whose look to take/ }).click()
  await (await chooser).setFiles({ name: 'look.png', mimeType: 'image/png', buffer: picture })
  await expect(page.getByRole('img', { name: 'The reference picture' })).toBeVisible()
}

test('a reference picture is sent with the run at its strength', async ({ page }) => {
  await openBackend(page)
  await chooseReference(page)
  await expect(page.getByText('Reference strength: 0.30')).toBeVisible()
  await page.getByRole('main').locator('#prompt').fill('a cat in this style')
  const sent = page.waitForRequest(isGenerate)
  await page.getByRole('button', { name: 'Generate', exact: true }).click()
  const body = (await sent).postDataJSON() as Record<string, unknown>
  expect(body).toMatchObject({ ip_adapter_scale: 0.3 })
  expect(String(body.ip_adapter_image_base64)).toMatch(/^data:image\/png;base64,/)
})

test('on ComfyUI with IPAdapter_plus, a reference picture is sent and the run finishes', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled()
  await page.getByRole('main').getByRole('combobox').first().click()
  await page.getByRole('option').filter({ has: page.getByText('comfy', { exact: true }) }).click()
  await expect(page.getByRole('button', { name: /Drop a picture whose look to take/ })).toBeVisible()
  await chooseReference(page)
  await page.getByRole('main').locator('#prompt').fill('a cat in this style')
  const sent = page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/gen/comfy/generate')
  await page.getByRole('button', { name: 'Generate', exact: true }).click()
  const body = (await sent).postDataJSON() as Record<string, unknown>
  expect(body).toMatchObject({ ip_adapter_scale: 0.3 })
  expect(String(body.ip_adapter_image_base64)).toMatch(/^data:image\/png;base64,/)
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled({ timeout: 30_000 })
  await expect(page.getByText(/Backend error|not in ComfyUI's list|Choose an IP-Adapter/)).toHaveCount(0)
})

test('hidden from Show, the reference is kept but not sent', async ({ page }) => {
  await openBackend(page)
  await chooseReference(page)
  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Reference' }).click()
  await expect(page.getByRole('img', { name: 'The reference picture' })).toHaveCount(0)
  await page.getByRole('main').locator('#prompt').fill('a cat')
  const sent = page.waitForRequest(isGenerate)
  await page.getByRole('button', { name: 'Generate', exact: true }).click()
  expect((await sent).postDataJSON()).not.toHaveProperty('ip_adapter_image_base64')
  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Reference' }).click()
  await expect(page.getByRole('img', { name: 'The reference picture' })).toBeVisible()
})
