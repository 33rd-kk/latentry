// docs/guide/generate.md: while a run is going, Generate becomes Add to queue.
// The page lists the runs it queued, and any of them can be taken out again.
// Another page sees only how many wait. Cancelling the running run starts the
// next one. Runs on the mock diffusers-compatible server, whose run with
// UNTIL_CANCELLED in the prompt goes on until it is cancelled.

import { expect, test, type Page } from '@playwright/test'
import { SLOW, UNTIL_CANCELLED } from '../__tests__/fixtures/mock-diffusers'

/** `button`: what the main button says once there, Generate or, with a run going, Add to queue. */
async function openOnPose(page: Page, button = 'Generate') {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled()
  // The backend select is the first one on the page.
  await page.getByRole('combobox').first().click()
  await page.getByRole('option').filter({ has: page.getByText('pose', { exact: true }) }).click()
  await expect(page.getByRole('button', { name: button, exact: true })).toBeEnabled()
}

test('runs wait their turn, can be taken out, and only their number is shown elsewhere', async ({ page, browser }) => {
  await openOnPose(page)
  await page.locator('#prompt').fill(`queue first ${UNTIL_CANCELLED}`)
  await page.getByRole('button', { name: 'Generate', exact: true }).click()
  const cancel = page.getByRole('button', { name: 'Cancel', exact: true })
  await expect(cancel).toBeVisible()

  const add = page.getByRole('button', { name: 'Add to queue' })
  await expect(add).toBeEnabled()
  await page.locator('#prompt').fill('queue second')
  await add.click()
  await page.locator('#prompt').fill('queue third')
  await add.click()

  const waiting = page.getByRole('region', { name: 'Waiting' })
  const rows = waiting.getByRole('listitem')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText('queue second')
  await expect(rows.nth(0)).toContainText('Starts next')
  await expect(rows.nth(1)).toContainText('queue third')
  await expect(rows.nth(1)).toContainText('After that')

  // Taken out again: the one behind it starts next.
  await rows.nth(0).getByRole('button', { name: 'Remove from the queue' }).click()
  await expect(rows).toHaveCount(1)
  await expect(rows.nth(0)).toContainText('queue third')
  await expect(rows.nth(0)).toContainText('Starts next')

  // Another page is told how many wait, not what.
  const other = await (await browser.newContext()).newPage()
  // It sees the run that is going, as after a reload, so its button queues too.
  await openOnPose(other, 'Add to queue')
  await expect(other.getByText('Waiting from other pages: 1')).toBeVisible()
  await expect(other.getByText('queue third')).toHaveCount(0)
  await expect(other.getByRole('button', { name: 'Remove from the queue' })).toHaveCount(0)
  await other.context().close()

  // Stopping the running run starts the waiting one, which this page then shows.
  await cancel.click()
  await expect(waiting).toHaveCount(0)
  await expect(page.locator('img[alt^="Generated image, seed"]')).toHaveCount(1)
  await expect(page.getByRole('link', { name: 'In gallery' })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled()
})

test('a run that leaves the screen to the next one stays below it', async ({ page }) => {
  await openOnPose(page)
  const results = page.locator('img[alt^="Generated image, seed"]')
  await page.locator('#prompt').fill('earlier first picture')
  await page.getByRole('button', { name: 'Generate', exact: true }).click()
  await expect(results).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled()

  await page.locator('#prompt').fill('earlier second picture')
  await page.getByRole('button', { name: 'Generate', exact: true }).click()
  // Newest first. (The page may also have picked up the last test's run, which
  // moved below in turn.)
  const newest = page.getByRole('region', { name: 'Earlier' }).locator(':scope > div').first()
  await expect(newest).toContainText('earlier first picture')
  await expect(newest.locator('img[alt^="Earlier picture, seed"]')).toHaveCount(1)
  await expect(results).toHaveCount(1)

  // Opens full screen like the run on screen.
  await newest.locator('img[alt^="Earlier picture, seed"]').click()
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('three queued runs, each starting the moment the last ends, all stay on the page', async ({ page }) => {
  await openOnPose(page)
  await page.locator('#prompt').fill(`queued run one ${SLOW}`)
  await page.getByRole('button', { name: 'Generate', exact: true }).click()
  const add = page.getByRole('button', { name: 'Add to queue' })
  await page.locator('#prompt').fill(`queued run two ${SLOW}`)
  await add.click()
  await page.locator('#prompt').fill(`queued run three ${SLOW}`)
  await add.click()

  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled({ timeout: 20_000 })
  await expect(page.locator('img[alt^="Generated image, seed"]')).toHaveCount(1)
  const blocks = page.getByRole('region', { name: 'Earlier' }).locator(':scope > div')
  await expect(blocks.nth(0)).toContainText('queued run two')
  await expect(blocks.nth(1)).toContainText('queued run one')
  await expect(blocks.nth(0).locator('img[alt^="Earlier picture, seed"]')).toHaveCount(1)
  await expect(blocks.nth(1).locator('img[alt^="Earlier picture, seed"]')).toHaveCount(1)
})
