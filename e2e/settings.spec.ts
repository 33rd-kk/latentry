// The settings page: it shows what settings.json holds, saves a change and
// shows it again after a reload, discards an unsaved one, tests a backend and
// puts the server's complaints next to the field they are about. What a test
// saves it takes back out, because the other specs share the server.

import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'

const card = (page: Page, title: string) => page.locator('[data-slot="card"]').filter({ has: page.getByText(title, { exact: true }) })
const saveButton = (page: Page) => page.getByRole('button', { name: 'Save', exact: true })

async function open(page: Page) {
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
}

async function save(page: Page) {
  await saveButton(page).click()
  await expect(page.getByText('Settings saved')).toBeVisible()
  await expect(saveButton(page)).toBeDisabled()
}

test('the backends from settings.json are shown, and one can be tested', async ({ page }) => {
  await open(page)
  const backends = card(page, 'Backends')
  await expect(backends.locator('input[value="mock"]')).toBeVisible()
  await expect(backends.locator('input[value="comfy"]')).toBeVisible()
  await expect(backends.getByText('Set here')).toBeVisible()
  // The ComfyUI one alone has a workflows folder.
  await expect(backends.getByText('Workflows folder')).toHaveCount(1)

  await backends.getByRole('button', { name: 'Test' }).first().click()
  await expect(backends.getByText(/^Connected: /)).toBeVisible()
})

test('a read folder with a display name is saved, comes back after a reload, and is removed again', async ({ page }) => {
  // A read folder has to exist.
  const folder = path.join(process.env.E2E_ROOT!, 'extra')
  mkdirSync(folder, { recursive: true })
  await open(page)
  const gallery = card(page, 'Gallery folders')
  const names = gallery.getByRole('textbox', { name: 'Display name' })
  // The save folder's display name comes first; read folders follow.
  await expect(names).toHaveCount(1)

  await gallery.getByRole('button', { name: 'Add folder' }).click()
  await expect(page.getByText('Unsaved changes')).toBeVisible()
  await names.nth(1).fill('Extra pictures')
  const dir = names.nth(1).locator('xpath=preceding-sibling::input')
  await dir.fill(folder)
  await save(page)

  await page.reload()
  await expect(names.nth(1)).toHaveValue('Extra pictures')
  await expect(dir).toHaveValue(folder)

  await gallery.getByRole('button', { name: 'Remove' }).click()
  await save(page)
  await page.reload()
  await expect(names).toHaveCount(1)
})

test('an unsaved profile change shows a reset, and Discard drops it', async ({ page }) => {
  await open(page)
  const profiles = card(page, 'Model profile defaults')
  const steps = profiles.locator('input[inputmode="decimal"]').nth(2)
  await expect(steps).toHaveValue('')
  await expect(profiles.getByRole('button', { name: 'Back to built-in' })).toHaveCount(0)

  await steps.fill('31')
  await expect(profiles.getByRole('button', { name: 'Back to built-in' })).toHaveCount(1)
  await expect(page.getByText('Unsaved changes')).toBeVisible()

  await page.getByRole('button', { name: 'Discard' }).click()
  await expect(steps).toHaveValue('')
  await expect(page.getByText('Unsaved changes')).toBeHidden()
  await expect(profiles.getByRole('button', { name: 'Back to built-in' })).toHaveCount(0)
})

test('what the server rejects is shown at its field, and nothing is saved', async ({ page }) => {
  await open(page)
  const backends = card(page, 'Backends')
  const url = backends.locator('input[placeholder="http://localhost:7860"]').first()
  await url.fill('not an address')
  await saveButton(page).click()
  await expect(page.getByText('Some values need fixing')).toBeVisible()
  await expect(backends.getByText('An http:// or https:// address.')).toHaveCount(1)

  await page.reload()
  await expect(url).not.toHaveValue('not an address')
})
