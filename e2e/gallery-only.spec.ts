// Gallery-only mode (lib/mode.ts): turned on in Settings, the home page is the
// gallery, nothing offers to generate, and the server closes generation's API
// as well. Every test turns it off again: the server is shared by every spec.

import sharp from 'sharp'
import { expect, test, type APIRequestContext, type Page } from './test'
import { UNTIL_CANCELLED } from '../__tests__/fixtures/mock-diffusers'

async function setMode(request: APIRequestContext, mode: 'gallery' | null) {
  const response = await request.put('/api/settings', { data: { mode } })
  expect(response.status(), await response.text()).toBe(200)
}

test.afterEach(async ({ request }) => {
  await setMode(request, null)
})

/** Generates one picture on the mock A1111 web UI, before the mode goes on. */
async function generate(page: Page, prompt: string) {
  await page.goto('/')
  const button = page.getByRole('button', { name: 'Generate', exact: true })
  await expect(button).toBeEnabled()
  await page.locator('#prompt').fill(prompt)
  await button.click()
  await expect(page.getByRole('link', { name: 'In gallery' })).toBeVisible()
}

test('Settings turns gallery-only mode on, and the pages follow', async ({ page }) => {
  await page.goto('/settings#mode')
  const toggle = page.getByRole('switch', { name: 'Gallery-only mode' })
  await expect(toggle).not.toBeChecked()
  // What stays and what goes is said next to the switch.
  await expect(page.getByText('Still there', { exact: true })).toBeVisible()
  await expect(page.getByText('Turned off', { exact: true })).toBeVisible()
  await toggle.click()
  await expect(toggle).toBeChecked()

  // The header loses Generate; Settings loses the sections only for generating.
  const nav = page.getByRole('banner').getByRole('navigation')
  await expect(nav.getByRole('link', { name: 'Generate' })).toHaveCount(0)
  await expect(nav.getByRole('link', { name: 'Gallery' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Backends' })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'Gallery' })).toBeVisible()

  // The home page is the gallery.
  await page.goto('/')
  await expect(page).toHaveURL(/\/gallery$/)
  await expect(page.getByPlaceholder('Search prompts, tags, models, file names')).toBeVisible()

  // Setup offers the tagger only.
  await page.goto('/setup')
  await expect(page.getByText('Gallery-only mode is on: only the WD14 tagger is set up here.', { exact: false })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Change it in Settings' })).toBeVisible()
  await expect(page.getByText('Engine', { exact: true })).toHaveCount(0)

  // And off again from Settings.
  await page.goto('/settings#mode')
  await page.getByRole('switch', { name: 'Gallery-only mode' }).click()
  await expect(page.getByRole('banner').getByRole('navigation').getByRole('link', { name: 'Generate' })).toBeVisible()
})

test('the viewer offers no way into generating', async ({ page, request }) => {
  const tag = `galleryonly${Date.now()}`
  await generate(page, `${tag} harbour`)
  await setMode(request, 'gallery')

  await page.goto('/gallery')
  const search = page.getByPlaceholder('Search prompts, tags, models, file names')
  await search.fill(tag)
  await search.press('Escape')
  const thumbs = page.locator('img[src^="/api/gallery/0/"][src*="thumb=1"]')
  await expect(thumbs).toHaveCount(1)
  await thumbs.first().click()
  const details = page.getByRole('button', { name: 'Details' })
  if ((await details.getAttribute('aria-pressed')) !== 'true') await details.click()
  // The panel is there, with downloads, but nothing that leads to Generate.
  await expect(page.getByRole('button', { name: 'Save without settings' })).toBeVisible()
  // The prompt is shown, as tags, but none of it can be sent to the form.
  await expect(page.getByText(`${tag} harbour`, { exact: false }).first()).toBeVisible()
  for (const name of ['Generate with these settings', 'Use as source', 'Use as pose reference', 'Upscale', 'Fix faces', 'All to positive', 'All to negative']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0)
  }
})

test('the server closes generation and reaches no backend', async ({ request }) => {
  await setMode(request, 'gallery')

  // Generating, and the rest of generation's API, answer 403.
  const generate = await request.post('/api/gen/mock/generate', { data: { prompt: 'closed' } })
  expect(generate.status()).toBe(403)
  expect((await generate.json()).galleryOnly).toBe(true)
  expect((await request.get('/api/gen/mock/job')).status()).toBe(403)
  expect((await request.get('/api/wildcards')).status()).toBe(403)
  expect((await request.post('/api/engine/start')).status()).toBe(403)
  expect((await request.post('/api/settings/test', { data: { kind: 'a1111', url: 'http://127.0.0.1:1' } })).status()).toBe(403)

  // Model downloads: only a tagger (not tried here: it would reach Hugging Face).
  const checkpoint = await request.post('/api/engine/models/download', { data: { id: 'illustrious-xl-2.0' } })
  expect(checkpoint.status()).toBe(403)
  const byUrl = await request.post('/api/engine/models/download', { data: { url: 'https://huggingface.co/a/b/blob/main/c.safetensors' } })
  expect(byUrl.status()).toBe(403)

  // No backend is listed or asked, so no backend's tagger either.
  const backends = await (await request.get('/api/gen/backends')).json()
  expect(backends.mode).toBe('gallery')
  expect(backends.backends).toEqual([])
  expect(backends.tagger).toBeNull()

  // The gallery and its tagging route stay open (no WD14 model here, so it says so).
  expect((await request.get('/api/gallery')).status()).toBe(200)
  const picture = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#557799' } }).png().toBuffer()
  const tag = await request.post('/api/gen/tag', { data: { image_base64: `data:image/png;base64,${picture.toString('base64')}` } })
  expect(tag.status()).not.toBe(403)

  // Back to full, generating works again.
  await setMode(request, null)
  expect((await request.get('/api/gen/mock/job')).status()).not.toBe(403)
})

test('runs going are asked about first, and stopped on yes', async ({ page, browser }) => {
  // A run that goes on until cancelled, and one waiting behind it, on the mock diffusers server.
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled()
  await page.getByRole('main').getByRole('combobox').first().click()
  await page.getByRole('option').filter({ has: page.getByText('pose', { exact: true }) }).click()
  await page.locator('#prompt').fill(`mode switch ${UNTIL_CANCELLED}`)
  await page.getByRole('button', { name: 'Generate', exact: true }).click()
  const cancel = page.getByRole('button', { name: 'Cancel', exact: true })
  await expect(cancel).toBeVisible()
  await page.locator('#prompt').fill('mode switch, waiting')
  await page.getByRole('button', { name: 'Add to queue' }).click()
  const waiting = page.getByRole('region', { name: 'Waiting' })
  await expect(waiting.getByRole('listitem')).toHaveCount(1)

  const settings = await (await browser.newContext()).newPage()
  await settings.goto('/settings#mode')
  const toggle = settings.getByRole('switch', { name: 'Gallery-only mode' })
  // No: nothing changes, the runs go on.
  let asked = ''
  settings.once('dialog', (dialog) => {
    asked = dialog.message()
    void dialog.dismiss()
  })
  await toggle.click()
  await expect.poll(() => asked).toContain('Runs drawing or waiting: 2.')
  await expect(toggle).not.toBeChecked()
  await expect(cancel).toBeVisible()
  await expect(waiting.getByRole('listitem')).toHaveCount(1)

  // Yes: both stop, and the mode goes on.
  settings.once('dialog', (dialog) => void dialog.accept())
  await toggle.click()
  await expect(toggle).toBeChecked()
  await expect(cancel).toHaveCount(0)
  await expect(waiting).toHaveCount(0)
  await settings.context().close()
})
