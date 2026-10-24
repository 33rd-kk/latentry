// What docs/guide/pose.md says about the skeleton and the 3D view, checked on
// the mock diffusers-compatible server with pose ("pose", which finds three
// people). Picking people and secret mode are in pose.spec.ts.

import { expect, test, type Page, type Request } from '@playwright/test'
import sharp from 'sharp'

const isPose = (request: Request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/gen/pose/pose'

async function openWithSkeleton(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled()
  await page.getByRole('main').getByRole('combobox').first().click()
  await page.getByRole('option').filter({ has: page.getByText('pose', { exact: true }) }).click()
  const picture = await sharp({ create: { width: 60, height: 90, channels: 3, background: '#887766' } }).png().toBuffer()
  const chooser = page.waitForEvent('filechooser')
  const answered = page.waitForResponse((response) => isPose(response.request()))
  await page.getByRole('button', { name: /Drop a picture to follow its pose/ }).click()
  await (await chooser).setFiles({ name: 'people.png', mimeType: 'image/png', buffer: picture })
  await answered
  await expect(page.getByRole('img', { name: 'Skeleton pose' })).toBeVisible()
}

// "Pose strength … 1.0 is what the pose model was trained at"
test('the skeleton comes with its strength', async ({ page }) => {
  await openWithSkeleton(page)
  await expect(page.getByText(/^Pose strength: \d\.\d\d$/)).toBeVisible()
  await expect(page.getByRole('slider', { name: /^Pose strength/ })).toBeVisible()
  await expect(page.getByText(/^1\.0 is what the pose model was trained at/)).toBeVisible()
})

// "Drag (up to 90° to either side …)"; "The angle and zoom show under the
// view. Press Use this pose … Front view goes back." The thumbnail then
// reads "Seen from yaw …".
test('turning the 3D view and using the angle', async ({ page }) => {
  await openWithSkeleton(page)
  const answered = page.waitForResponse((response) => isPose(response.request()))
  await page.getByRole('button', { name: '3D', exact: true }).click()
  await answered
  await expect(page.getByText('Yaw 0°, pitch 0°, zoom ×1.0')).toBeVisible()

  const view = page.locator('canvas:visible').last()
  await view.scrollIntoViewIfNeeded()
  const box = (await view.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect(page.getByText(/^Yaw -?[1-9]\d*°, pitch -?\d+°, zoom ×1\.0$/)).toBeVisible()

  const use = page.getByRole('button', { name: 'Use this pose' })
  await expect(use).toBeEnabled()
  const turned = page.waitForResponse((response) => isPose(response.request()))
  await use.click()
  await turned
  await expect(page.getByText(/^Seen from yaw -?[1-9]\d*°/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Front view' })).toBeEnabled()
})

// "changing the output size fits the skeleton inside; Detect again lines it up"
test('a new output size is noted, and Detect again redraws the skeleton', async ({ page }) => {
  await openWithSkeleton(page)
  await page.getByRole('button', { name: '1216×832' }).click()
  await expect(page.getByText(/^The output size changed since this skeleton was drawn/)).toBeVisible()
  const again = page.waitForRequest(isPose)
  await page.getByRole('button', { name: 'Detect again' }).click()
  expect((await again).postDataJSON()).toMatchObject({ width: 1216, height: 832 })
  await expect(page.getByText(/^The output size changed since this skeleton was drawn/)).toBeHidden()
})

// "switching to a backend without pose: a warning says the skeleton is left
// out of the run"
test('a backend without pose says the skeleton is left out', async ({ page }) => {
  await openWithSkeleton(page)
  await page.getByRole('main').getByRole('combobox').first().click()
  await page.getByRole('option').filter({ has: page.getByText('mock', { exact: true }) }).click()
  await expect(page.getByText(/^This backend cannot follow a pose, so the skeleton you set is left out of the run/)).toBeVisible()
})
