// The pose slot on diffusers-compatible backends with pose (the mock in
// __tests__/fixtures/mock-diffusers.ts finds three people): a picture is
// detected, people are picked (one by one on "pose", which takes a list; one
// or everyone on "pose-single", which does not), the 3D view opens, and
// secret mode blurs the picture people are picked from but not their boxes.

import { expect, test, type Page, type Request } from '@playwright/test'
import sharp from 'sharp'

const isPose = (request: Request) => request.method() === 'POST' && /^\/api\/gen\/pose(-single)?\/pose$/.test(new URL(request.url()).pathname)

/** What the page asked /api/pose for, without the picture. */
function asked(request: Request): Record<string, unknown> {
  const { image_base64: _picture, ...rest } = request.postDataJSON() as Record<string, unknown>
  return rest
}

async function openPoseBackend(page: Page, id: 'pose' | 'pose-single' = 'pose') {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled()
  // The backend select is the first one in the page's main area (the header has the language menu).
  await page.getByRole('main').getByRole('combobox').first().click()
  await page.getByRole('option').filter({ has: page.getByText(id, { exact: true }) }).click()
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

test('on a backend that takes one or everyone, a person is picked, and the skeleton removed', async ({ page }) => {
  await openPoseBackend(page, 'pose-single')
  const first = asked(await choosePicture(page))
  // A new picture names nobody and starts from the front.
  expect(first).not.toHaveProperty('person')
  expect(first).not.toHaveProperty('camera')
  expect(first).toMatchObject({ width: expect.any(Number), height: expect.any(Number) })

  await expect(page.getByRole('img', { name: 'Skeleton pose' })).toBeVisible()
  await expect(page.getByText('Found 3 people. Pick whose pose to follow.')).toBeVisible()
  // It says why it cannot pick two of them.
  await expect(page.getByText('This backend follows one person or everyone.', { exact: false })).toBeVisible()
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

test('on a backend that takes a list, people are switched on and off one by one', async ({ page }) => {
  await openPoseBackend(page)
  await choosePicture(page)
  await expect(page.getByText('Click each one to follow or leave out', { exact: false })).toBeVisible()
  await expect(page.getByText('This backend follows one person or everyone.', { exact: false })).toHaveCount(0)
  const person = (n: number) => page.getByRole('button', { name: `Person ${n}` })
  const pressed = async (expected: boolean[]) => {
    for (const [index, on] of expected.entries()) await expect(person(index + 1)).toHaveAttribute('aria-pressed', String(on))
  }
  // The server drew its most confident one; it is the only one, so it cannot be left out.
  await pressed([false, true, false])
  await expect(person(2)).toBeDisabled()

  expect(await poseAfter(page, () => person(3).click())).toMatchObject({ person: [1, 2] })
  await pressed([false, true, true])
  // All three is everyone, as the Everyone button sends.
  expect(await poseAfter(page, () => person(1).click())).toMatchObject({ person: -1 })
  await pressed([true, true, true])
  await expect(page.getByRole('button', { name: 'Everyone' })).toHaveAttribute('aria-pressed', 'true')
  expect(await poseAfter(page, () => person(2).click())).toMatchObject({ person: [0, 2] })
  await pressed([true, false, true])
  // Back to one is a plain index.
  expect(await poseAfter(page, () => person(1).click())).toMatchObject({ person: 2 })
  await pressed([false, false, true])
  await expect(person(3)).toBeDisabled()
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
  await expect(page.getByRole('button', { name: 'Use this pose' })).toBeDisabled()
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
  expect(await poseAfter(page, () => page.getByRole('button', { name: 'Person 3' }).click())).toMatchObject({ person: [1, 2] })
})

test('in the 3D view a joint is dragged, used, undone, and the camera still swings elsewhere', async ({ page }) => {
  await openPoseBackend(page)
  const output = asked(await choosePicture(page)) as { width: number; height: number }
  await expect(page.getByRole('img', { name: 'Skeleton pose' })).toBeVisible()
  await poseAfter(page, () => page.getByRole('button', { name: '3D', exact: true }).click())
  await expect(page.getByText('Yaw 0°, pitch 0°, zoom ×1.0')).toBeVisible()

  const view = page.locator('canvas:visible').last()
  await view.scrollIntoViewIfNeeded()
  const box = (await view.boundingBox())!
  // Where a picture point (units of its width, y down) shows from the front:
  // the 60×90 picture letterboxed onto the output, the output onto the canvas.
  const onCanvas = (x: number, y: number) => {
    const scale = Math.min(output.width, output.height / 1.5)
    return {
      x: box.x + (((output.width - scale) / 2 + x * scale) / output.width) * box.width,
      y: box.y + (((output.height - scale * 1.5) / 2 + y * scale) / output.height) * box.height,
    }
  }
  // The drawn person (the mock's second, centred at 0.5) has its left wrist at (0.61, 0.68).
  const wrist = onCanvas(0.61, 0.68)
  await page.mouse.move(wrist.x, wrist.y)
  await page.mouse.down()
  await page.mouse.move(wrist.x + 30, wrist.y - 40, { steps: 6 })
  await page.mouse.up()
  // A joint moved; the camera did not.
  await expect(page.getByText('Joints moved: 1')).toBeVisible()
  await expect(page.getByText('Yaw 0°, pitch 0°, zoom ×1.0')).toBeVisible()

  const use = page.getByRole('button', { name: 'Use this pose' })
  await expect(use).toBeEnabled()
  const used = await poseAfter(page, () => use.click())
  expect(used).toMatchObject({ person: 1, edits: [{ person: 1, joint: 9, to: [expect.any(Number), expect.any(Number), expect.any(Number)] }] })
  expect(used).not.toHaveProperty('camera')
  await expect(use).toBeDisabled()

  // Undone, the skeleton can be drawn again without it.
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByText('Joints moved: 1')).toHaveCount(0)
  expect(await poseAfter(page, () => use.click())).not.toHaveProperty('edits')

  // Away from the joints a drag still swings the camera.
  await page.mouse.move(box.x + 10, box.y + 10)
  await page.mouse.down()
  await page.mouse.move(box.x + 90, box.y + 10, { steps: 8 })
  await page.mouse.up()
  await expect(page.getByText(/^Yaw -?[1-9]\d*°, pitch -?\d+°, zoom ×1\.0$/)).toBeVisible()
})

test('on a backend that does not move joints, the 3D view says so', async ({ page }) => {
  await openPoseBackend(page, 'pose-single')
  await choosePicture(page)
  await poseAfter(page, () => page.getByRole('button', { name: '3D', exact: true }).click())
  await expect(page.getByText(/^Joints cannot be moved here/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reset joints' })).toHaveCount(0)
})

test('Undo takes back camera moves and joint moves in the order they were made', async ({ page }) => {
  await openPoseBackend(page)
  const output = asked(await choosePicture(page)) as { width: number; height: number }
  await poseAfter(page, () => page.getByRole('button', { name: '3D', exact: true }).click())
  const view = page.locator('canvas:visible').last()
  await view.scrollIntoViewIfNeeded()
  const box = (await view.boundingBox())!
  const undo = page.getByRole('button', { name: 'Undo' })
  await expect(undo).toBeDisabled()

  // Turn the camera, away from the figure.
  await page.mouse.move(box.x + 10, box.y + 10)
  await page.mouse.down()
  await page.mouse.move(box.x + 50, box.y + 10, { steps: 8 })
  await page.mouse.up()
  const turned = (await page.getByText(/^Yaw /).textContent())!
  expect(turned).not.toBe('Yaw 0°, pitch 0°, zoom ×1.0')
  const yaw = (Number(/Yaw (-?\d+)/.exec(turned)![1]) * Math.PI) / 180

  // Then move the wrist, where the turn put it (all the mock's points are at depth 0).
  const scale = Math.min(output.width, output.height / 1.5)
  const x = 0.5 + 0.11 * Math.cos(yaw)
  const wrist = {
    x: box.x + (((output.width - scale) / 2 + x * scale) / output.width) * box.width,
    y: box.y + (((output.height - scale * 1.5) / 2 + 0.68 * scale) / output.height) * box.height,
  }
  await page.mouse.move(wrist.x, wrist.y)
  await page.mouse.down()
  await page.mouse.move(wrist.x + 20, wrist.y - 40, { steps: 6 })
  await page.mouse.up()
  await expect(page.getByText('Joints moved: 1')).toBeVisible()
  await expect(page.getByText(turned)).toBeVisible()

  // Undo: the wrist first, then the turn.
  await undo.click()
  await expect(page.getByText('Joints moved: 1')).toHaveCount(0)
  await expect(page.getByText(turned)).toBeVisible()
  await undo.click()
  await expect(page.getByText('Yaw 0°, pitch 0°, zoom ×1.0')).toBeVisible()
  await expect(undo).toBeDisabled()
})
