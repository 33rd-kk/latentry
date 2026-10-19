// What docs/guide/generate.md says about the form, checked on the mock
// A1111 web UI ("mock") and the mock ComfyUI ("comfy"). Each test names the
// section it checks; a failure here means the guide or the app is wrong.

import { expect, test, type Page } from '@playwright/test'
import sharp from 'sharp'

const generateButton = (page: Page) => page.getByRole('button', { name: 'Generate', exact: true })

async function open(page: Page) {
  await page.goto('/')
  await expect(generateButton(page)).toBeEnabled()
}

async function pickBackend(page: Page, id: string) {
  // The backend select is the first one on the page.
  await page.getByRole('combobox').first().click()
  await page.getByRole('option').filter({ has: page.getByText(id, { exact: true }) }).click()
  await expect(generateButton(page)).toBeEnabled()
}

async function chooseSource(page: Page) {
  const picture = await sharp({ create: { width: 64, height: 96, channels: 3, background: '#557799' } }).png().toBuffer()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /Drop an image or click to choose/ }).click()
  await (await chooser).setFiles({ name: 'source.png', mimeType: 'image/png', buffer: picture })
  await expect(page.getByRole('radiogroup', { name: 'What the source is for' })).toBeVisible()
}

// "Backend: A dot shows whether it is ready, busy or offline."
test('the backend shows that it is ready', async ({ page }) => {
  await open(page)
  await expect(page.getByText('Ready', { exact: true })).toBeVisible()
})

// "Share across backends": off by default; on, prompt and artist are shared,
// "The negative prompt is always per backend."
test('prompts are per backend until shared, and the negative prompt stays per backend', async ({ page }) => {
  await open(page)
  const share = page.getByRole('switch', { name: 'Share across backends' })
  await expect(share).not.toBeChecked()
  await page.locator('#prompt').fill('only on mock')
  await pickBackend(page, 'comfy')
  await expect(page.locator('#prompt')).not.toHaveValue('only on mock')

  await pickBackend(page, 'mock')
  await expect(page.locator('#prompt')).toHaveValue('only on mock')
  await page.getByRole('switch', { name: 'Share across backends' }).click()
  await page.locator('#prompt').fill('shared prompt')
  await page.locator('#negative-prompt').fill('mock negative')
  await pickBackend(page, 'comfy')
  await expect(page.locator('#prompt')).toHaveValue('shared prompt')
  await expect(page.locator('#negative-prompt')).not.toHaveValue('mock negative')
  // Leave it as the other tests expect it.
  await page.getByRole('switch', { name: 'Share across backends' }).click()
})

// "Source image": Variation / edit, Pose reference (strength starts at
// 0.85), Upscale and Extend; "Hires fix … with a source image the section is hidden".
test('a source offers its four uses, and hides hires fix', async ({ page }) => {
  await open(page)
  await expect(page.getByRole('switch', { name: 'Hires fix' })).toBeVisible()
  await chooseSource(page)
  await expect(page.getByRole('radio')).toHaveText(['Variation / edit', 'Pose reference', 'Upscale', 'Extend'])
  await expect(page.getByRole('switch', { name: 'Hires fix' })).toBeHidden()
  await page.getByRole('radio', { name: 'Pose reference' }).click()
  await expect(page.getByText('Strength: 0.85')).toBeVisible()
  // "Upscale … Width and Height are not used."
  await page.getByRole('radio', { name: 'Upscale' }).click()
  await expect(page.getByText(/Width and Height below are not used/)).toBeVisible()
  await expect(page.getByText(/^Upscale by: /)).toBeVisible()
})

// "Draw mask … Brush, Eraser, Clear and the brush size are under the picture."
test('the mask editor has a brush, an eraser, clear and a size', async ({ page }) => {
  await open(page)
  await chooseSource(page)
  await page.getByRole('button', { name: 'Draw mask' }).click()
  for (const name of ['Brush', 'Eraser', 'Clear']) await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
  await expect(page.getByText(/^Size \d+$/)).toBeVisible()
})

// "the arrows swap them"; "Seed: -1 for random (the button sets it)".
test('width and height swap, and the seed button makes it random', async ({ page }) => {
  await open(page)
  const width = page.getByText(/^Width: \d+$/)
  const height = page.getByText(/^Height: \d+$/)
  // A square size would not show a swap: take a tall one first.
  await page.getByRole('button', { name: '832×1216' }).click()
  await expect(width).toHaveText('Width: 832')
  await page.getByRole('button', { name: 'Swap width and height' }).click()
  await expect(width).toHaveText('Width: 1216')
  await expect(height).toHaveText('Height: 832')

  const seed = page.getByLabel('Seed (-1: random)')
  await seed.fill('42')
  await page.getByRole('button', { name: 'Random seed (-1)' }).click()
  await expect(seed).toHaveValue('-1')
})

// "A slider moved from its default shows a small arrow at the end of its
// label: press it to put that one slider back." "Reset (the arrow next to
// Generate) restores the profile defaults for this backend."
test('a moved slider can be put back, and Reset puts the whole form back', async ({ page }) => {
  await open(page)
  const steps = page.getByText(/^Steps: \d+$/)
  const before = await steps.textContent()
  await page.getByRole('slider', { name: /^Steps/ }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(steps).not.toHaveText(before!)
  const back = page.getByRole('button', { name: /^Reset to \d+$/ })
  await expect(back).toHaveCount(1)
  await back.click()
  await expect(steps).toHaveText(before!)
  await expect(back).toHaveCount(0)

  await page.locator('#prompt').fill('to be reset')
  await page.getByRole('slider', { name: /^Steps/ }).focus()
  await page.keyboard.press('ArrowRight')
  await page.getByRole('button', { name: "Reset this backend's form" }).click()
  await expect(steps).toHaveText(before!)
})

// "Backends that cannot do something list it under Not available on this
// backend"; an A1111 web UI cannot follow a skeleton (pose.md).
test('what the A1111 web UI cannot do is listed, with why', async ({ page }) => {
  await open(page)
  const line = page.getByText(/^Not available on this backend: /)
  await expect(line).toContainText('Skeleton pose')
  await line.click()
  await expect(page.getByText(/Latentry cannot drive pose control on an A1111 web UI/)).toBeVisible()
})

// "Results: In gallery, Use as source, Download. Click it to view it full screen."
test('a result has In gallery, Use as source and Download, and opens full screen', async ({ page }) => {
  await open(page)
  await page.locator('#prompt').fill('docs generate result')
  await generateButton(page).click()
  await expect(page.getByRole('link', { name: 'In gallery' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Use as source' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Download' })).toBeVisible()
  await page.getByRole('button', { name: /^Generated image, seed/ }).first().click()
  await expect(page.locator('.pswp')).toBeVisible()
})

// privacy.md: "Prompt fields and the gallery's search have the browser's
// spell check and autofill turned off."
test('prompt fields have spell check and autofill off', async ({ page }) => {
  await open(page)
  for (const id of ['#prompt', '#negative-prompt']) {
    await expect(page.locator(id)).toHaveAttribute('spellcheck', 'false')
    await expect(page.locator(id)).toHaveAttribute('autocomplete', 'off')
  }
  await page.goto('/gallery')
  const search = page.getByPlaceholder('Search prompts, tags, models, file names')
  await expect(search).toHaveAttribute('spellcheck', 'false')
  await expect(search).toHaveAttribute('autocomplete', 'off')
})
