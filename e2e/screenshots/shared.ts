// What the screenshot files share (see scripts/docs-screenshots.mjs): where
// shots go, the privacy rewrite of /api answers, the check that a shot names
// nothing of this computer, and taking a shot of the window or a part of it.

import { mkdirSync } from 'node:fs'
import { hostname, userInfo } from 'node:os'
import path from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import sharp from 'sharp'

export const root = process.env.E2E_ROOT!
export const out = process.env.DOCS_SHOTS_OUT!
const only = process.env.DOCS_SHOTS_ONLY
/** Shots on the real engine (DOCS_ENGINE_MODELS set), instead of the mocks. */
export const onEngine = !!process.env.DOCS_ENGINE_MODELS

export const WIDTH = 1280
export const SCALE = 1.25
const ports = ['E2E_PORT', 'E2E_MOCK_PORT', 'E2E_COMFY_PORT', 'E2E_POSE_PORT', 'E2E_POSE_SINGLE_PORT'].map((name) => process.env[name]!)

/** Folders of this computer that answers may name: the temp folder, and the engine's when it runs. */
const folders = [root, process.env.DOCS_ENGINE_MODELS, process.env.DOCS_ENGINE_RUNTIME, process.env.DOCS_COMFY_WORKFLOWS, process.cwd()].filter(
  (folder): folder is string => !!folder
)

/** What must never be in a published shot. */
const forbidden = [
  userInfo().username,
  hostname(),
  ...folders,
  ...folders.map((folder) => folder.replaceAll('\\', '/')),
  'AppData',
  'latentry-docs-',
  '127.0.0.1',
  ...ports.map((port) => `:${port}`),
  // Ports the author's own backends listen on.
  ':55355',
  ':55356',
].filter((text) => text && text.length > 2)

test.use({ viewport: { width: WIDTH, height: 820 }, deviceScaleFactor: SCALE, colorScheme: 'light' })

/** Swaps this computer's paths and the backends' addresses in every /api answer for generic ones. */
export async function generic(page: Page) {
  await page.route(/\/api\//, async (route) => {
    const request = route.request()
    if (request.method() !== 'GET' || /\/stream$/.test(new URL(request.url()).pathname)) return route.fallback()
    let response
    let body
    try {
      response = await route.fetch()
      if (!(response.headers()['content-type'] ?? '').includes('json')) return await route.fulfill({ response })
      body = await response.text()
    } catch {
      // A poll cut short by the page moving on: nothing reaches the page.
      return route.abort().catch(() => {})
    }
    // Longest first, so a folder inside another is replaced whole.
    for (const folder of [...folders].sort((a, b) => b.length - a.length)) {
      for (const form of [JSON.stringify(folder).slice(1, -1), folder.replaceAll('\\', '/')]) body = body.split(form).join('C:\\\\latentry')
    }
    body = body.replace(/(127\.0\.0\.1|localhost):\d+/g, 'localhost:7860')
    return route.fulfill({ response, body }).catch(() => {})
  })
}

export async function checkClean(page: Page) {
  const seen = await page.evaluate(() => {
    const parts = [document.body.innerText]
    for (const field of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')) parts.push(field.value, field.placeholder)
    for (const element of document.querySelectorAll('[title], [alt], [aria-label]')) {
      parts.push(element.getAttribute('title') ?? '', element.getAttribute('alt') ?? '', element.getAttribute('aria-label') ?? '')
    }
    return parts.join('\n')
  })
  for (const text of forbidden) expect(seen.includes(text), `the page shows "${text}"`).toBe(false)
}

async function writeWebp(name: string, png: Buffer) {
  mkdirSync(out, { recursive: true })
  await sharp(png).webp({ quality: 84 }).toFile(path.join(out, `${name}.webp`))
}

/** The whole window, or one part of the page. */
export async function shot(page: Page, name: string, target?: Locator) {
  await checkClean(page)
  // Let lazy thumbnails and transitions settle (a run's stream keeps the network busy).
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {})
  await page.waitForTimeout(400)
  const png = target ? await target.screenshot({ animations: 'disabled' }) : await page.screenshot({ animations: 'disabled' })
  await writeWebp(name, png)
}

/** From the top of one locator to the bottom of another, across the page's width or the given column; `below` is the margin under it (smaller when the next line sits close). */
export async function shotBetween(page: Page, name: string, top: Locator, bottom: Locator, column?: Locator, below = 12) {
  await checkClean(page)
  await page.waitForTimeout(400)
  const a = (await top.boundingBox())!
  const b = (await bottom.boundingBox())!
  const c = column ? (await column.boundingBox())! : { x: 0, width: WIDTH }
  const pad = 12
  const png = await page.screenshot({
    animations: 'disabled',
    fullPage: true,
    clip: { x: Math.max(0, c.x - pad), y: Math.max(0, a.y - pad), width: Math.min(WIDTH, c.width + 2 * pad), height: b.y + b.height - a.y + pad + below },
  })
  await writeWebp(name, png)
}

/** A shot's test: skipped when DOCS_SHOTS_ONLY names others. */
export const take = (name: string) => (only && !name.includes(only) ? test.skip : test)

export async function openGenerate(page: Page, backend: string) {
  await generic(page)
  await page.goto('/')
  const generate = page.getByRole('button', { name: 'Generate', exact: true })
  await expect(generate).toBeEnabled({ timeout: 60_000 })
  const picker = page.getByRole('main').getByRole('combobox').first()
  if (!(await picker.textContent())?.includes(backend)) {
    await picker.click()
    await page.getByRole('option').filter({ has: page.getByText(backend, { exact: true }) }).click()
    await expect(generate).toBeEnabled({ timeout: 60_000 })
  }
}
