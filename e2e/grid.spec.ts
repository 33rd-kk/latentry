// docs/guide/generate.md, "X/Y grid": the run drawn again for each value of
// one or two settings, queued as one run, its cells filled in as they finish.
// A finished grid can be saved as one sheet, which the gallery stacks with
// its cells, and a grid that is going can be stopped as a whole. Runs on the
// mock diffusers-compatible server, whose run with UNTIL_CANCELLED in the
// prompt goes on until it is cancelled.

import { expect, test, type Page } from '@playwright/test'
import { UNTIL_CANCELLED } from '../__tests__/fixtures/mock-diffusers'

async function openOnPose(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled()
  // The backend select is the first one on the page.
  await page.getByRole('combobox').first().click()
  await page.getByRole('option').filter({ has: page.getByText('pose', { exact: true }) }).click()
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled()
}

/** Turns the grid on with CFG across (its starting values) and, when given, steps down. */
async function setUpGrid(page: Page, steps?: string) {
  await page.getByRole('switch', { name: 'Draw a grid' }).click()
  await expect(page.getByRole('combobox', { name: 'X axis' })).toContainText('CFG')
  if (steps) {
    await page.getByRole('combobox', { name: 'Y axis' }).click()
    await page.getByRole('option', { name: 'Steps', exact: true }).click()
    await page.getByRole('textbox', { name: 'Values' }).nth(1).fill(steps)
  }
}

test('a grid fills in cell by cell, and its sheet is saved and stacked with it', async ({ page }) => {
  await openOnPose(page)
  await page.locator('#prompt').fill('grid lighthouse')
  await setUpGrid(page, '10, 20')
  await expect(page.getByText('6 cells, 6 pictures')).toBeVisible()

  // A value the setting cannot take is said before anything is sent.
  const xValues = page.getByRole('textbox', { name: 'Values' }).first()
  await xValues.fill('4, 99')
  await expect(page.getByText('X axis: “99” is not a value this setting takes.')).toBeVisible()
  await expect(page.getByRole('button', { name: /Queue grid/ })).toHaveCount(0)
  await xValues.fill('4, 6, 8')

  await page.getByRole('button', { name: 'Queue grid (6)' }).click()
  const grid = page.getByRole('region', { name: 'CFG × Steps' })
  await expect(grid).toBeVisible()
  await expect(grid.getByRole('columnheader')).toContainText(['', '4', '6', '8'])
  await expect(grid.getByRole('rowheader')).toContainText(['10', '20'])
  await expect(grid.locator('img[alt^="Cell "]')).toHaveCount(6)
  await expect(grid.getByText('Done')).toBeVisible()
  await expect(grid.getByText(/Every cell uses seed \d+/)).toBeVisible()

  // Full screen: each picture is named by its place in the grid.
  await grid.locator('img[alt="Cell 6, 20"]').click()
  await expect(page.getByRole('dialog')).toContainText('CFG: 6 · Steps: 20')
  await page.keyboard.press('Escape')

  // Secret mode does not offer the sheet; turned off again, it is there.
  const secretToggle = page.getByRole('button', { name: 'Secret mode' }).first()
  await secretToggle.click()
  await expect(grid.getByRole('button', { name: 'Save sheet' })).toHaveCount(0)
  await expect(grid.locator('img.blur-xl')).toHaveCount(6)
  await secretToggle.click()

  await grid.getByRole('button', { name: 'Save sheet' }).click()
  await expect(page.getByText('The sheet was saved to the gallery.')).toBeVisible()

  // The gallery stacks the grid's six cells and its sheet.
  await page.goto('/gallery')
  await page.getByPlaceholder('Search prompts, tags, models, file names').fill('grid lighthouse')
  const thumbs = page.locator('img[src^="/api/gallery/0/"][src*="thumb=1"]')
  await expect(thumbs).toHaveCount(7)
  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  await page.getByRole('combobox', { name: 'Stack' }).click()
  await page.getByRole('option', { name: 'Same X/Y grid' }).click()
  await expect(thumbs).toHaveCount(1)
  await expect(page.getByTitle('7 pictures. Click to see them all.')).toHaveText('7')
})

test('a grid that is going is stopped as a whole', async ({ page }) => {
  await openOnPose(page)
  await page.locator('#prompt').fill(`grid stopped ${UNTIL_CANCELLED}`)
  await setUpGrid(page)
  await page.getByRole('button', { name: 'Queue grid (3)' }).click()
  const grid = page.getByRole('region', { name: 'CFG', exact: true })
  await expect(grid.getByText('Cell 1 of 3')).toBeVisible()
  // While it goes, Generate queues behind it.
  await page.getByRole('switch', { name: 'Draw a grid' }).click()
  await expect(page.getByRole('button', { name: 'Add to queue' })).toBeVisible()

  await grid.getByRole('button', { name: 'Cancel grid' }).click()
  await expect(grid.getByText('Cancelled')).toBeVisible()
  await expect(grid.getByText('Did not run')).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled()
})
