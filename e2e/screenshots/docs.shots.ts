// The guide's screenshots, taken by `npm run docs:screenshots` (see
// scripts/docs-screenshots.mjs), not by `npm run test:e2e`. The gallery is
// filled here with poseorbit's public example pictures and drawn stand-ins,
// and every /api answer has this computer's paths and ports swapped for
// generic ones before the page sees it. Each shot is then checked for
// anything that names this computer, and fails rather than save one that does.

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import sharp from 'sharp'
import { LATENTRY_KEY, writePngText } from '../../lib/image-meta/png'
import { generic, onEngine, openGenerate as openOn, out, root, shot, shotBetween, take, WIDTH } from './shared'

// The real engine's shots are in engine.shots.ts.
test.skip(onEngine)

// poseorbit's docs/assets/examples, published under its licence with the
// package; a checkout next to this one, or POSEORBIT_EXAMPLES.
const examples = process.env.POSEORBIT_EXAMPLES || path.resolve('..', 'poseorbit', 'docs', 'assets', 'examples')
const reference = path.join(examples, 'reference.jpg')

const openGenerate = (page: Page, backend = 'forge') => openOn(page, backend)

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

take('manual-wildcards')('wildcard picker', async ({ page }) => {
  await openGenerate(page)
  await page.locator('#prompt').fill('1girl, solo, __hair__, __outfit__, smile, full body, __places/outdoors__')
  await page.locator('#prompt').blur()
  await expect(page.getByRole('combobox', { name: 'Add a wildcard' })).toBeVisible()
  await shotBetween(page, 'manual-wildcards', page.getByText('Positive prompt', { exact: true }), page.getByText(/^Prepended when generating/), page.locator('[data-slot="card"]').first())
})

take('manual-upscale')('upscale a source', async ({ page }) => {
  await openGenerate(page)
  await page.locator('#prompt').fill('1girl, solo, grey hair, grey hoodie, waving, smile, full body')
  await page.locator('input[type="file"][accept="image/*"]').first().setInputFiles(path.join(root, 'reference.jpg'))
  await page.getByRole('radio', { name: 'Upscale' }).click()
  await expect(page.getByText(/^Upscale by: /)).toBeVisible()
  await shotBetween(page, 'manual-upscale', page.getByText('Source image (img2img)', { exact: true }), page.getByText(/^Denoising strength: /), page.locator('[data-slot="card"]').first())
})

take('manual-extend')('extend a source', async ({ page }) => {
  await openGenerate(page)
  await page.locator('#prompt').fill('1girl, solo, grey hair, grey hoodie, waving, smile, full body, park, trees')
  await page.locator('input[type="file"][accept="image/*"]').first().setInputFiles(path.join(root, 'reference.jpg'))
  await page.getByRole('radio', { name: 'Extend' }).click()
  for (const side of ['Left', 'Right']) {
    const slider = page.getByRole('slider', { name: new RegExp(`^${side}:`) })
    await slider.focus()
    for (let step = 0; step < 4; step++) await slider.press('PageUp')
    await slider.blur()
  }
  await expect(page.getByText(/^New canvas: /)).toBeVisible()
  await shotBetween(page, 'manual-extend', page.getByText('Source image (img2img)', { exact: true }), page.getByText(/^Draws the new area/), page.locator('[data-slot="card"]').first())
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
  await page.goto('/settings#devices')
  const card = page.locator('[data-slot="card"]').filter({ has: page.getByText('Phones and other computers', { exact: true }) })
  await card.getByRole('button', { name: 'Add a device' }).click()
  await expect(card.getByText(/It works once, for/)).toBeVisible()
  await card.scrollIntoViewIfNeeded()
  await shot(page, 'manual-pairing', card)
})

take('manual-pair-phone')('pairing page on a phone', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'light', locale: 'en-US' })
  const page = await context.newPage()
  await generic(page)
  await page.goto('/pair')
  await expect(page.getByRole('button', { name: 'Pair', exact: true })).toBeVisible()
  await shot(page, 'manual-pair-phone')
  await context.close()
})
