// The guide's screenshots, taken by `npm run docs:screenshots` (see
// scripts/docs-screenshots.mjs), not by `npm run test:e2e`. The gallery is
// filled here with poseorbit's public example pictures and drawn stand-ins,
// and every /api answer has this computer's paths and ports swapped for
// generic ones before the page sees it. Each shot is then checked for
// anything that names this computer, and fails rather than save one that does.

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { hostname, userInfo } from 'node:os'
import path from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import sharp from 'sharp'
import { LATENTRY_KEY, writePngText } from '../../lib/image-meta/png'

const root = process.env.E2E_ROOT!
const out = process.env.DOCS_SHOTS_OUT!
const only = process.env.DOCS_SHOTS_ONLY
// poseorbit's docs/assets/examples, published under its licence with the
// package; a checkout next to this one, or POSEORBIT_EXAMPLES.
const examples = process.env.POSEORBIT_EXAMPLES || path.resolve('..', 'poseorbit', 'docs', 'assets', 'examples')
const reference = path.join(examples, 'reference.jpg')

const WIDTH = 1280
const SCALE = 1.25
const ports = ['E2E_PORT', 'E2E_MOCK_PORT', 'E2E_COMFY_PORT', 'E2E_POSE_PORT', 'E2E_POSE_SINGLE_PORT'].map((name) => process.env[name]!)

/** What must never be in a published shot. */
const forbidden = [
  userInfo().username,
  hostname(),
  root,
  root.replaceAll('\\', '/'),
  'AppData',
  'latentry-docs-',
  '127.0.0.1',
  ...ports.map((port) => `:${port}`),
  // Ports the author's own backends listen on.
  ':55355',
  ':55356',
].filter((text) => text && text.length > 2)

test.use({ viewport: { width: WIDTH, height: 820 }, deviceScaleFactor: SCALE, colorScheme: 'light' })

// ---- the gallery's pictures ----------------------------------------------

const NEGATIVE = 'lowres, worst quality, bad anatomy, bad hands, text, watermark'
let seed = 1000

function record(prompt: string, width: number, height: number, extra: Record<string, unknown> = {}) {
  seed += 7
  return {
    schema: 1,
    backend: 'forge',
    kind: 'a1111',
    profile: 'illustrious',
    model: 'illustrious-xl-v1.0.safetensors',
    mode: 'txt2img',
    prompt,
    negative_prompt: NEGATIVE,
    seed,
    width,
    height,
    sampler: 'Euler a',
    scheduler: 'Automatic',
    steps: 28,
    cfg: 5.5,
    created: new Date(Date.UTC(2026, 9, 18, 9, seed % 60)).toISOString(),
    ...extra,
  }
}

/** A plain drawn landscape: sky, sun and two ranges of hills. */
function landscape(width: number, height: number, sky: [string, string], sun: string, hills: [string, string]) {
  const h = height
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}">
  <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset="1" stop-color="${sky[1]}"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#s)"/>
  <circle cx="${width * 0.68}" cy="${h * 0.42}" r="${Math.min(width, h) * 0.09}" fill="${sun}" opacity="0.9"/>
  <path d="M0 ${h * 0.66} Q ${width * 0.25} ${h * 0.5} ${width * 0.5} ${h * 0.62} T ${width} ${h * 0.58} V ${h} H 0 Z" fill="${hills[0]}"/>
  <path d="M0 ${h * 0.8} Q ${width * 0.3} ${h * 0.68} ${width * 0.6} ${h * 0.78} T ${width} ${h * 0.74} V ${h} H 0 Z" fill="${hills[1]}"/>
</svg>`)
}

async function save(name: string, png: Buffer, meta: Record<string, unknown>) {
  writeFileSync(path.join(root, 'out', name), writePngText(png, { [LATENTRY_KEY]: JSON.stringify(meta) }))
}

test.beforeAll(async () => {
  if (!existsSync(reference)) throw new Error(`poseorbit's example pictures were not found in ${examples}; set POSEORBIT_EXAMPLES.`)
  mkdirSync(out, { recursive: true })
  sharp.cache(false)
  const scenes: [string, number, number, [string, string], string, [string, string]][] = [
    ['scenery, mountains, dusk, orange sky, no humans', 1216, 832, ['#f6b77c', '#f7e2c4'], '#fff4d6', ['#7c6a8a', '#4a3f5c']],
    ['scenery, lake, morning mist, pale blue sky, no humans', 1216, 832, ['#a9c9e8', '#e6f0f7'], '#ffffff', ['#7fa3a8', '#4f7378']],
    ['scenery, hills, night, starry sky, crescent moon, no humans', 832, 1216, ['#1d2547', '#4a4f86'], '#f2f0d8', ['#2e3560', '#1b1f3d']],
    ['scenery, meadow, summer, blue sky, clouds, no humans', 1024, 1024, ['#6fb3e8', '#d9eefb'], '#fffbe6', ['#8cc06f', '#5c9a4b']],
    ['scenery, desert, sunset, purple sky, no humans', 1216, 832, ['#8a5ea8', '#f3a07a'], '#ffe2b0', ['#d58f5c', '#a8653d']],
    ['scenery, autumn forest, golden hour, no humans', 832, 1216, ['#f0c27b', '#fbe7c6'], '#fff7e0', ['#c26a3d', '#8a3f25']],
  ]
  for (const [index, [prompt, width, height, sky, sun, hills]] of scenes.entries()) {
    const png = await sharp(landscape(width / 2, height / 2, sky, sun, hills)).png().toBuffer()
    await save(`20261018-09${10 + index}00_forge_${1000 + index}_0.png`, png, record(prompt, width / 2, height / 2))
  }
  const people: [string, string][] = [
    ['reference.jpg', '1girl, solo, grey hair, grey hoodie, black pants, sneakers, waving, smile, full body, simple background'],
    ['turn-result.jpg', '1girl, solo, black hair, short hair, blue hoodie, jeans, sneakers, peace sign, smile, full body, white background'],
    ['closeup-result.jpg', '1girl, solo, black hair, short hair, blue hoodie, brown eyes, smile, portrait, white background'],
  ]
  for (const [index, [file, prompt]] of people.entries()) {
    const png = await sharp(path.join(examples, file)).png().toBuffer()
    const { width, height } = await sharp(png).metadata()
    await save(`20261018-1000${index}_forge_${2000 + index}_0.png`, png, record(prompt, width!, height!))
  }
  // The compare dialog's pair: the same shape, two prompts.
  copyFileSync(reference, path.join(root, 'reference.jpg'))
})

// ---- privacy: rewrite, then check ----------------------------------------

/** Swaps this computer's paths and the mocks' addresses in every /api answer for generic ones. */
async function generic(page: Page) {
  await page.route(/\/api\//, async (route) => {
    const request = route.request()
    if (request.method() !== 'GET' || /\/stream$/.test(new URL(request.url()).pathname)) return route.fallback()
    const response = await route.fetch()
    const type = response.headers()['content-type'] ?? ''
    if (!type.includes('json')) return route.fulfill({ response })
    let body = await response.text()
    for (const form of [root, root.replaceAll('\\', '/'), JSON.stringify(root).slice(1, -1)]) body = body.split(form).join('C:\\\\latentry')
    body = body.replace(/127\.0\.0\.1:\d+/g, 'localhost:7860')
    return route.fulfill({ response, body })
  })
}

async function checkClean(page: Page) {
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
  await sharp(png).webp({ quality: 84 }).toFile(path.join(out, `${name}.webp`))
}

/** The whole window, or one part of the page. */
async function shot(page: Page, name: string, target?: Locator) {
  await checkClean(page)
  // Let lazy thumbnails and transitions settle (a run's stream keeps the network busy).
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {})
  await page.waitForTimeout(400)
  const png = target ? await target.screenshot({ animations: 'disabled' }) : await page.screenshot({ animations: 'disabled' })
  await writeWebp(name, png)
}

/** From the top of one locator to the bottom of another, across the page's width or the given column. */
async function shotBetween(page: Page, name: string, top: Locator, bottom: Locator, column?: Locator) {
  await checkClean(page)
  await page.waitForTimeout(400)
  const a = (await top.boundingBox())!
  const b = (await bottom.boundingBox())!
  const c = column ? (await column.boundingBox())! : { x: 0, width: WIDTH }
  const pad = 12
  const png = await page.screenshot({
    animations: 'disabled',
    fullPage: true,
    clip: { x: Math.max(0, c.x - pad), y: Math.max(0, a.y - pad), width: Math.min(WIDTH, c.width + 2 * pad), height: b.y + b.height - a.y + 2 * pad },
  })
  await writeWebp(name, png)
}

const take = (name: string) => (only && !name.includes(only) ? test.skip : test)

async function openGenerate(page: Page, backend = 'forge') {
  await generic(page)
  await page.goto('/')
  const generate = page.getByRole('button', { name: 'Generate', exact: true })
  await expect(generate).toBeEnabled()
  const picker = page.getByRole('combobox').first()
  if (!(await picker.textContent())?.includes(backend)) {
    await picker.click()
    await page.getByRole('option').filter({ has: page.getByText(backend, { exact: true }) }).click()
    await expect(generate).toBeEnabled()
  }
}

async function openGallery(page: Page) {
  await generic(page)
  await page.goto('/gallery')
  await expect(page.locator('img[src^="/api/gallery/0/"][src*="thumb=1"]')).toHaveCount(9)
}

// ---- the shots -----------------------------------------------------------

take('manual-gallery')('gallery', async ({ page }) => {
  await openGallery(page)
  await page.getByRole('button', { name: 'Tags', exact: true }).click()
  await shot(page, 'manual-gallery')
  await page.getByRole('button', { name: 'Tags', exact: true }).click()
})

take('manual-filters')('gallery filters', async ({ page }) => {
  await openGallery(page)
  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  await page.getByRole('button', { name: 'Portrait', exact: true }).click()
  await page.getByRole('button', { name: 'PNG', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Clear all' })).toBeVisible()
  await shotBetween(page, 'manual-filters', page.getByPlaceholder('Search prompts, tags, models, file names'), page.getByRole('button', { name: 'Clear all' }), page.locator('main'))
})

take('manual-compare')('compare', async ({ page }) => {
  await openGallery(page)
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  await page.getByRole('button', { name: /^1girl, solo, grey hair/ }).click()
  await page.getByRole('button', { name: /^1girl, solo, black hair, short hair, blue hoodie, jeans/ }).click()
  await page.getByRole('button', { name: 'Compare', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('slider')).toBeVisible()
  await shot(page, 'manual-compare', dialog)
})

take('manual-viewer')('viewer', async ({ page }) => {
  await openGallery(page)
  await page.getByRole('button', { name: /^1girl, solo, grey hair/ }).click()
  const useSettings = page.getByRole('button', { name: 'Generate with these settings' })
  if (!(await useSettings.isVisible())) await page.getByRole('button', { name: 'Details' }).click()
  await expect(useSettings).toBeVisible()
  await shot(page, 'manual-viewer')
})

take('manual-hires')('hires fix', async ({ page }) => {
  await openGenerate(page)
  const hires = page.getByRole('switch', { name: 'Hires fix' })
  await hires.click()
  await expect(page.getByText(/^Upscale by: /)).toBeVisible()
  await shot(page, 'manual-hires', page.locator('div.rounded-md.border').filter({ has: hires }))
})

take('manual-upscale')('upscale a source', async ({ page }) => {
  await openGenerate(page)
  await page.locator('#prompt').fill('1girl, solo, grey hair, grey hoodie, waving, smile, full body')
  await page.locator('input[type="file"][accept="image/*"]').first().setInputFiles(path.join(root, 'reference.jpg'))
  await page.getByRole('radio', { name: 'Upscale' }).click()
  await expect(page.getByText(/^Upscale by: /)).toBeVisible()
  await shotBetween(page, 'manual-upscale', page.getByText('Source image (img2img)', { exact: true }), page.getByText(/^Denoising strength: /), page.locator('[data-slot="card"]').first())
})

take('manual-secret-results')('secret mode on Generate', async ({ page }) => {
  // Tall enough that nothing scrolls under the sticky header.
  await page.setViewportSize({ width: WIDTH, height: 1500 })
  await openGenerate(page)
  await page.locator('#prompt').fill('scenery, mountains, dusk, orange sky, no humans')
  await page.getByRole('button', { name: 'Secret mode' }).first().click()
  await page.getByRole('button', { name: 'Generate', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Show results' })).toBeVisible()
  await shotBetween(page, 'manual-secret-results', page.getByText('Pictures blurred in secret mode.'), page.getByRole('link', { name: 'Download' }), page.locator('[data-slot="card"]').nth(1))
})

take('manual-pairing')('pairing card', async ({ page }) => {
  await generic(page)
  await page.goto('/settings')
  const card = page.locator('[data-slot="card"]').filter({ has: page.getByText('Phones and other computers', { exact: true }) })
  await card.getByRole('button', { name: 'Add a device' }).click()
  await expect(card.getByText(/It works once, for/)).toBeVisible()
  await card.scrollIntoViewIfNeeded()
  await shot(page, 'manual-pairing', card)
})

take('manual-pair-phone')('pairing page on a phone', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'light' })
  const page = await context.newPage()
  await generic(page)
  await page.goto('/pair')
  await expect(page.getByRole('button', { name: 'Pair', exact: true })).toBeVisible()
  await shot(page, 'manual-pair-phone')
  await context.close()
})
