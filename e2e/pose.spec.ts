// The pose slot on a diffusers-compatible backend with pose (the mock in
// __tests__/fixtures/mock-diffusers.ts finds three people): a picture is
// detected, a person is picked, the 3D view opens, and secret mode blurs the
// picture people are picked from but not their numbered boxes.

import { expect, test, type Page, type Request } from '@playwright/test'
import sharp from 'sharp'

const isPose = (request: Request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/gen/pose/pose'

/** What the page asked /api/pose for, without the picture. */
function asked(request: Request): Record<string, unknown> {
  const { image_base64: _picture, ...rest } = request.postDataJSON() as Record<string, unknown>
  return rest
}

async function openPoseBackend(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled()
  // The backend select is the first one on the page.
  await page.getByRole('combobox').first().click()
  await page.getByRole('option').filter({ hasText: 'diffusers' }).click()
  await expect(page.getByText('Skeleton pose', { exact: true })).toBeVisible()
}

/** Picks a picture through the drop area's file chooser; resolves with the /api/pose request it made. */
async function choosePicture(page: Page): Promise<Request> {
  const picture = await sharp({ create: { width: 60, height: 90, channels: 3, background: '#887766' } }).png().toBuffer()
  const chooser = page.waitForEvent('filechooser')
  const request = page.waitForRequest(isPose)
  await page.getByRole('button', { name: /Drop a picture to follow its pose/ }).click()
  await (await chooser).setFiles({ name: 'people.png', mimeType: 'image/png', buffer: picture })
  return request
}

/** Clicks and resolves with the /api/pose request that click made, once its answer is in. */
async function poseAfter(page: Page, click: () => Promise<void>): Promise<Record<string, unknown>> {
  const request = page.waitForRequest(isPose)
  const answered = page.waitForResponse((response) => isPose(response.request()))
  await click()
  const sent = asked(await request)
  await answered
  return sent
}

test('a picture is detected, a person picked, and the skeleton removed', async ({ page }) => {
  await openPoseBackend(page)
  const first = asked(await choosePicture(page))
  // A new picture names nobody and starts from the front.
  expect(first).not.toHaveProperty('person')
  expect(first).not.toHaveProperty('camera')
  expect(first).toMatchObject({ width: expect.any(Number), height: expect.any(Number) })

  await expect(page.getByRole('img', { name: 'Skeleton pose' })).toBeVisible()
  await expect(page.getByText('Found 3 people. Pick whose pose to follow.')).toBeVisible()
  // The server drew its most confident one: the second from the left.
  await expect(page.getByRole('button', { name: 'Person 2' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Person 1' })).toHaveAttribute('aria-pressed', 'false')

  expect(await poseAfter(page, () => page.getByRole('button', { name: 'Person 1' }).click())).toMatchObject({ person: 0 })
  await expect(page.getByRole('button', { name: 'Person 1' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Person 2' })).toHaveAttribute('aria-pressed', 'false')

  expect(await poseAfter(page, () => page.getByRole('button', { name: 'Everyone' }).click())).toMatchObject({ person: -1 })
  await expect(page.getByRole('button', { name: 'Everyone' })).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByRole('img', { name: 'Skeleton pose' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Drop a picture to follow its pose/ })).toBeVisible()
})

test('the 3D view asks for the points once and starts from the front', async ({ page }) => {
  await openPoseBackend(page)
  await choosePicture(page)
  await expect(page.getByRole('img', { name: 'Skeleton pose' })).toBeVisible()

  const opened = await poseAfter(page, () => page.getByRole('button', { name: '3D', exact: true }).click())
  // For the person already drawn, so the skeleton does not change under the user.
  expect(opened).toMatchObject({ want_3d: true, person: 1 })
  await expect(page.getByText('Yaw 0°, pitch 0°, zoom ×1.0')).toBeVisible()
  // Nothing turned yet: there is no other angle to use, and it is already the front.
  await expect(page.getByRole('button', { name: 'Use this angle' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Front view' })).toBeDisabled()

  // Closed and opened again, the points it has are kept.
  let again = 0
  page.on('request', (request) => isPose(request) && again++)
  await page.getByRole('button', { name: '3D', exact: true }).click()
  await page.getByRole('button', { name: '3D', exact: true }).click()
  await expect(page.getByText('Yaw 0°, pitch 0°, zoom ×1.0')).toBeVisible()
  expect(again).toBe(0)
})

test('in secret mode the picture is blurred, its numbered boxes are not', async ({ page }) => {
  await openPoseBackend(page)
  await page.getByRole('button', { name: 'Secret mode' }).first().click()
  await choosePicture(page)

  const chooser = page.locator('img[alt=""].blur-xl')
  await expect(chooser).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Person 3' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Person 3' })).not.toHaveClass(/blur/)

  await page.getByRole('button', { name: 'Show picture' }).click()
  await expect(chooser).toHaveCount(0)
  await page.getByRole('button', { name: 'Blur picture' }).click()
  await expect(chooser).toHaveCount(1)

  // A person can still be picked while it is blurred.
  expect(await poseAfter(page, () => page.getByRole('button', { name: 'Person 3' }).click())).toMatchObject({ person: 2 })
})
