// The screenshots that need the real engine, taken by `npm run
// docs:screenshots` with DOCS_ENGINE_MODELS set (see
// scripts/docs-screenshots.mjs). The engine first draws a fresh gallery into
// the temp folder from the prompts below, with fixed seeds; then the shots of
// the gallery, the viewer, the 3D view, Setup and (with DOCS_COMFY_URL) a
// ComfyUI workflow are taken from it.

import { cpSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { generic, onEngine, openGenerate, root, shot, shotBetween, take } from './shared'

test.skip(!onEngine)
test.describe.configure({ mode: 'serial' })

/** A gallery card, by its picture's prompt (as saved: the profile writes tags with underscores). */
const card = (page: Page, prompt: RegExp) => page.locator('button', { has: page.getByRole('img', { name: prompt }) })
const thumbs = (page: Page) => page.locator('img[src^="/api/gallery/0/"][src*="thumb=1"]')

/** What the gallery is drawn from: the prompt (the profile adds its quality tags), the size and the seed. */
const PICTURES: [string, string, number][] = [
  ['1girl, solo, white hair, short hair, blue eyes, white hoodie, city street at night, neon lights, rain, looking at viewer, upper body', '832×1216', 1001],
  ['1girl, solo, red hair, ponytail, school uniform, classroom, sitting at desk, window, sunlight, smile', '832×1216', 1002],
  ['no humans, scenery, castle on a cliff, blue sky, clouds, wide shot', '832×1216', 1003],
  ['1girl, solo, long black hair, kimono, red umbrella, cherry blossoms, smile, cowboy shot', '832×1216', 1004],
  ['no humans, cat, sleeping, windowsill, potted plants, sunlight, cozy', '1024×1024', 1005],
  ['no humans, scenery, mountain lake, reflection, pine forest, dusk', '1216×832', 1006],
  ['no humans, scenery, snowy village, night, lanterns, winter', '1216×832', 1007],
  ['no humans, scenery, underwater, ruins, light rays, fish', '1216×832', 1008],
  ['no humans, still life, flowers in vase, books, tea cup, wooden table, window', '832×1216', 1009],
  ['2girls, full body, standing, side by side, hoodie, jeans, sneakers, waving, smile, simple background, white background', '1216×832', 1010],
  // One person in a scene: on a plain background this prompt drew a character sheet.
  ['1girl, solo, full body, standing, waving, smile, looking at viewer, short brown hair, grey hoodie, blue jeans, sneakers, outdoors, park, trees, day', '832×1216', 1111],
]

test('the engine draws the gallery', async ({ page }) => {
  test.setTimeout(30 * 60_000)
  // DOCS_ENGINE_GALLERY: the pictures an earlier run drew (its temp folder's
  // out/, kept with E2E_KEEP=1); only the ones it lacks are drawn.
  const earlier = process.env.DOCS_ENGINE_GALLERY
  if (earlier && existsSync(earlier)) cpSync(earlier, path.join(root, 'out'), { recursive: true })
  const drawn = readdirSync(path.join(root, 'out')).join('\n')
  const missing = PICTURES.filter(([, , seed]) => !drawn.includes(`_engine_${seed}_`))
  if (missing.length === 0) return
  await openGenerate(page, 'engine')
  const generate = page.getByRole('button', { name: 'Generate', exact: true })
  for (const [prompt, size, seed] of missing) {
    await page.locator('#prompt').fill(prompt)
    await page.getByRole('button', { name: size, exact: true }).click()
    await page.getByRole('textbox', { name: 'Seed (-1: random)' }).fill(String(seed))
    await generate.click()
    await expect(page.getByText(`seed: ${seed}`)).toBeVisible({ timeout: 5 * 60_000 })
    await expect(page.getByRole('link', { name: 'In gallery' })).toBeVisible()
    await expect(generate).toBeEnabled()
  }
})

async function openGallery(page: Page) {
  await generic(page)
  await page.goto('/gallery')
  await expect(thumbs(page)).toHaveCount(PICTURES.length)
}

take('screenshot-gallery')('gallery', async ({ page }) => {
  await openGallery(page)
  await shot(page, 'screenshot-gallery')
  await page.getByRole('button', { name: 'Tags', exact: true }).click()
  await shot(page, 'manual-gallery')
  await page.getByRole('button', { name: 'Tags', exact: true }).click()
})

take('screenshot-viewer')('viewer, with WD14 tags', async ({ page }) => {
  await openGallery(page)
  await card(page, /1girl, solo, white_hair/).click()
  // "Analyze again" on pictures reused from a run that tagged them.
  const analyze = page.getByRole('button', { name: /^Analyze (with WD14|again)$/ })
  if (!(await analyze.isVisible())) await page.getByRole('button', { name: 'Details' }).click()
  await analyze.click()
  await expect(page.getByText('WD14 tags', { exact: true })).toBeVisible({ timeout: 120_000 })
  await shot(page, 'screenshot-viewer')
  await shot(page, 'manual-viewer')
})

take('manual-3d')('3D view, from a full-body picture', async ({ page }) => {
  // Tall enough that nothing scrolls under the sticky header.
  await page.setViewportSize({ width: 1280, height: 2400 })
  await openGallery(page)
  await card(page, /1girl, solo, full_body, standing, waving/).click()
  const usePose = page.getByRole('button', { name: 'Use as pose reference' })
  if (!(await usePose.isVisible())) await page.getByRole('button', { name: 'Details' }).click()
  await usePose.click()
  await expect(page).toHaveURL(/\/$/)
  // The form opens on the backend chosen last; the skeleton needs the engine.
  const picker = page.getByRole('main').getByRole('combobox').first()
  if (!(await picker.textContent())?.includes('engine')) {
    await picker.click()
    await page.getByRole('option').filter({ has: page.getByText('engine', { exact: true }) }).click()
  }
  // Draw the skeleton from the reference, then open the 3D view.
  await page.getByRole('button', { name: "Use the source's pose" }).click()
  await expect(page.getByRole('img', { name: 'Skeleton pose' })).toBeVisible({ timeout: 120_000 })
  await page.getByRole('button', { name: '3D', exact: true }).click()
  await expect(page.getByText(/^Yaw 0°/)).toBeVisible({ timeout: 120_000 })
  const view = page.locator('canvas:visible').last()
  await view.scrollIntoViewIfNeeded()
  const box = (await view.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 25, box.y + box.height / 2 + 4, { steps: 6 })
  await page.mouse.up()
  await expect(page.getByRole('button', { name: 'Use this pose' })).toBeEnabled()
  await shotBetween(page, 'manual-3d', page.getByRole('img', { name: 'Skeleton pose' }), page.getByRole('button', { name: 'Use this pose' }), page.locator('[data-slot="card"]').first())
})

take('manual-setup')('Setup with the engine running', async ({ page }) => {
  // The whole page in the window, so the sticky header stays at the top.
  await page.setViewportSize({ width: 1152, height: 2700 })
  await generic(page)
  await page.goto('/setup')
  await expect(page.getByText('Running', { exact: true })).toBeVisible({ timeout: 120_000 })
  await expect(page.getByText('Loaded', { exact: true })).toBeVisible()
  await shot(page, 'manual-setup', page.locator('main'))
})

take('manual-workflow')('a ComfyUI workflow', async ({ page }) => {
  test.skip(!process.env.DOCS_COMFY_URL || !process.env.DOCS_COMFY_WORKFLOWS, 'no ComfyUI given')
  await openGenerate(page, 'comfyui')
  // The folder's workflow, and what the page says about it.
  await page.getByRole('combobox', { name: 'Workflow' }).click()
  await page.getByRole('option', { name: 'portrait' }).click()
  // A workflow says what it cannot take (and, when its file lacks one, which settings stay as saved).
  const note = page.getByText(/^A workflow draws from the prompt only/)
  await expect(note).toBeVisible()
  // From the workflow down: the line above names the checkpoint ComfyUI has.
  await shotBetween(page, 'manual-workflow', page.getByText('Workflow', { exact: true }).first(), note, page.locator('[data-slot="card"]').first())
})
