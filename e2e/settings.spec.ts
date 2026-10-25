// The settings page: it shows what settings.json holds, one section at a time,
// saves a change and shows it again after a reload, discards an unsaved one,
// tests a backend and puts the server's complaints next to the field they are
// about. What a test saves it takes back out, because the other specs share
// the server.

import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'

const card = (page: Page, title: string) => page.locator('[data-slot="card"]').filter({ has: page.getByText(title, { exact: true }) })
const saveButton = (page: Page) => page.getByRole('button', { name: 'Save', exact: true })
const tab = (page: Page, name: string) => page.getByRole('tab', { name: new RegExp(`^${name}`) })

/** Opens Settings at one section, as a link to it would. */
async function open(page: Page, section = 'backends') {
  await page.goto(`/settings#${section}`)
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
}

test('the list on the left shows one section at a time, and the browser keeps the last one', async ({ page }) => {
  await open(page)
  await expect(tab(page, 'Backends')).toHaveAttribute('aria-selected', 'true')
  await expect(card(page, 'Backends')).toBeVisible()
  await expect(card(page, 'Gallery folders')).toHaveCount(0)

  await tab(page, 'Gallery').click()
  await expect(card(page, 'Gallery folders')).toBeVisible()
  await expect(card(page, 'Backends')).toHaveCount(0)
  await expect(page).toHaveURL(/\/settings#gallery$/)

  // Without a section in the address, the one chosen last comes back.
  await page.goto('/settings')
  await expect(tab(page, 'Gallery')).toHaveAttribute('aria-selected', 'true')
})

test('a section with unsaved changes is marked in the list, and the change survives switching', async ({ page }) => {
  await open(page, 'profiles')
  const steps = card(page, 'Model profile defaults').locator('input[inputmode="decimal"]').nth(2)
  await steps.fill('31')
  await expect(tab(page, 'Profiles').getByRole('img', { name: 'Unsaved changes' })).toBeVisible()
  await expect(tab(page, 'Backends').getByRole('img')).toHaveCount(0)

  await tab(page, 'Backends').click()
  await tab(page, 'Profiles').click()
  await expect(steps).toHaveValue('31')
  await page.getByRole('button', { name: 'Discard' }).click()
  await expect(tab(page, 'Profiles').getByRole('img')).toHaveCount(0)
})

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
  await open(page, 'gallery')
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
  await open(page, 'profiles')
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

test('a ComfyUI reached over the network without a token is warned about as it is typed', async ({ page }) => {
  await open(page)
  const backends = card(page, 'Backends')
  const warning = backends.getByText(/^This ComfyUI is reached over the network/)
  // The ComfyUI one is on this computer, so there is nothing to say yet.
  await expect(warning).toBeHidden()

  const url = backends.locator('input[placeholder="http://localhost:7860"]').nth(1)
  const address = await url.inputValue()
  await url.fill('http://192.168.1.20:8188/')
  await expect(warning).toBeVisible()
  await backends.locator('input[type="password"]').nth(1).fill('a-proxy-token')
  await expect(warning).toBeHidden()

  await page.getByRole('button', { name: 'Discard' }).click()
  await expect(url).toHaveValue(address)
  await expect(warning).toBeHidden()
})

test('what the server rejects is shown at its field, and nothing is saved', async ({ page }) => {
  await open(page)
  const backends = card(page, 'Backends')
  const url = backends.locator('input[placeholder="http://localhost:7860"]').first()
  await url.fill('not an address')
  await saveButton(page).click()
  await expect(page.getByText('Some values need fixing')).toBeVisible()
  await expect(backends.getByText('An http:// or https:// address.')).toHaveCount(1)
  // The list says where, for when another section is open.
  await expect(tab(page, 'Backends').getByRole('img', { name: 'Has a field to fix' })).toBeVisible()
  await expect(tab(page, 'Gallery').getByRole('img')).toHaveCount(0)

  await page.reload()
  await expect(url).not.toHaveValue('not an address')
})

test('the pairing card says Latentry listens on this computer only', async ({ page }) => {
  // The browser tests' server is started by scripts/serve.mjs on 127.0.0.1.
  await open(page, 'devices')
  await expect(page.getByText('Latentry listens on this computer only.', { exact: false })).toBeVisible()
  await expect(page.getByText('Latentry is open to your network', { exact: false })).toHaveCount(0)
})

test('Settings shows the version of Latentry it runs', async ({ page }) => {
  await open(page)
  await expect(page.getByText(/^Latentry \d+\.\d+\.\d+/)).toBeVisible()
})
