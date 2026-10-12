// Sliders on a touch screen: a tap on the track leaves the value alone (a
// swipe to scroll often starts there), and only a drag from the thumb moves it.

import { expect, test, type Page } from '@playwright/test'

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

async function firstSlider(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled()
  const root = page.locator('[data-slot="slider"]').first()
  const thumb = root.getByRole('slider')
  await expect(thumb).toBeVisible()
  return { root, thumb }
}

async function box(locator: ReturnType<Page['locator']>) {
  const found = await locator.boundingBox()
  if (!found) throw new Error('not on screen')
  return found
}

test('a tap on the track does not move a slider', async ({ page }) => {
  const { root, thumb } = await firstSlider(page)
  const before = await thumb.getAttribute('aria-valuenow')
  const track = await box(root)
  await page.touchscreen.tap(track.x + track.width - 4, track.y + track.height / 2)
  await page.touchscreen.tap(track.x + 4, track.y + track.height / 2)
  await expect(thumb).toHaveAttribute('aria-valuenow', before!)
})

test('a drag from the thumb moves a slider', async ({ page }) => {
  const { thumb } = await firstSlider(page)
  const before = Number(await thumb.getAttribute('aria-valuenow'))
  const start = await box(thumb)
  const x = start.x + start.width / 2
  const y = start.y + start.height / 2
  const cdp = await page.context().newCDPSession(page)
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: { x: number; y: number }[]) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points })
  await touch('touchStart', [{ x, y }])
  for (let step = 1; step <= 5; step++) await touch('touchMove', [{ x: x + step * 20, y }])
  await touch('touchEnd', [])
  await expect.poll(async () => Number(await thumb.getAttribute('aria-valuenow'))).toBeGreaterThan(before)
})

test('a mouse click on the track still moves a slider', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL })
  const page = await context.newPage()
  const { root, thumb } = await firstSlider(page)
  const before = Number(await thumb.getAttribute('aria-valuenow'))
  const track = await box(root)
  await page.mouse.click(track.x + track.width - 4, track.y + track.height / 2)
  await expect.poll(async () => Number(await thumb.getAttribute('aria-valuenow'))).toBeGreaterThan(before)
  await context.close()
})
