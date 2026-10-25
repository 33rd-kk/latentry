// Accessibility: axe-core checks each page against WCAG 2.1 A and AA, in the
// light and the dark theme. A serious or critical finding fails the test;
// lesser ones are printed, so they can be looked at without blocking.
//
// axe runs inside the page and reads only the page: nothing is sent anywhere.

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import sharp from 'sharp'

const PAGES = [
  { path: '/', ready: (page: Page) => page.getByRole('button', { name: 'Generate', exact: true }) },
  { path: '/gallery', ready: (page: Page) => page.getByPlaceholder('Search prompts, tags, models, file names') },
  { path: '/settings', ready: (page: Page) => page.getByRole('heading', { name: 'Settings', exact: true }) },
  { path: '/setup', ready: (page: Page) => page.getByRole('heading', { name: 'Setup', exact: true }) },
  { path: '/pair', ready: (page: Page) => page.getByRole('textbox', { name: 'Code' }) },
]

async function scan(page: Page, label: string) {
  // Mid-fade, text is part transparent and axe reads the wrong colours (the
  // viewer fades its controls in): wait for every animation that ends to end.
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== 'running' || animation.effect?.getTiming().iterations === Infinity)
  )
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  const report = violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.slice(0, 5).map((node) => node.target.join(' ')),
  }))
  const minor = report.filter((item) => item.impact !== 'serious' && item.impact !== 'critical')
  if (minor.length) console.log(`${label}: lesser findings\n${JSON.stringify(minor, null, 2)}`)
  expect(report.filter((item) => item.impact === 'serious' || item.impact === 'critical'), `${label}: serious or critical findings`).toEqual([])
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme })
    for (const { path, ready } of PAGES) {
      test(`${path} has no serious accessibility findings`, async ({ page }) => {
        await page.goto(path)
        await expect(ready(page)).toBeVisible()
        // The theme follows the system's, so this is the theme axe sees.
        await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${scheme}\\b`))
        await scan(page, `${path} (${scheme})`)
      })
    }
  })
}

// What only shows after a click: the viewer with its panel, Compare, the mask
// editor and the 3D pose view. In the dark theme, which the viewer always uses.
test.describe('opened views', () => {
  test.use({ colorScheme: 'dark' })

  /** Generates on the mock A1111 web UI and waits for the picture to be saved. */
  async function generate(page: Page, prompt: string) {
    await page.goto('/')
    const button = page.getByRole('button', { name: 'Generate', exact: true })
    await expect(button).toBeEnabled()
    await page.locator('#prompt').fill(prompt)
    await button.click()
    await expect(page.getByRole('link', { name: 'In gallery' })).toBeVisible()
  }

  test('the viewer and Compare have no serious accessibility findings', async ({ page }) => {
    const tag = `a11yspec${Date.now()}`
    await generate(page, `${tag} harbour`)
    await generate(page, `${tag} meadow`)
    await page.goto('/gallery')
    await page.getByPlaceholder('Search prompts, tags, models, file names').fill(tag)
    const thumbs = page.locator('img[src^="/api/gallery/0/"][src*="thumb=1"]')
    await expect(thumbs).toHaveCount(2)

    await thumbs.first().click()
    const useSettings = page.getByRole('button', { name: 'Generate with these settings' })
    if (!(await useSettings.isVisible())) await page.getByRole('button', { name: 'Details' }).click()
    await expect(useSettings).toBeVisible()
    await scan(page, 'viewer with its panel')
    await page.getByRole('button', { name: 'Close', exact: true }).click()

    await page.getByRole('button', { name: 'Select', exact: true }).click()
    await page.getByRole('button', { name: 'Select all 2' }).click()
    await page.getByRole('button', { name: 'Compare', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await scan(page, 'Compare')
  })

  test('the mask editor has no serious accessibility findings', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled()
    const picture = await sharp({ create: { width: 64, height: 96, channels: 3, background: '#557799' } }).png().toBuffer()
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: /Drop an image or click to choose/ }).click()
    await (await chooser).setFiles({ name: 'source.png', mimeType: 'image/png', buffer: picture })
    await page.getByRole('button', { name: 'Draw mask' }).click()
    await expect(page.getByRole('button', { name: 'Eraser', exact: true })).toBeVisible()
    await scan(page, 'mask editor')
  })

  test('the 3D pose view has no serious accessibility findings', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled()
    // The backend select is the first one in the page's main area (the header has the language menu).
    await page.getByRole('main').getByRole('combobox').first().click()
    await page.getByRole('option').filter({ has: page.getByText('pose', { exact: true }) }).click()
    const picture = await sharp({ create: { width: 60, height: 90, channels: 3, background: '#887766' } }).png().toBuffer()
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: /Drop a picture to follow its pose/ }).click()
    await (await chooser).setFiles({ name: 'people.png', mimeType: 'image/png', buffer: picture })
    await expect(page.getByRole('img', { name: 'Skeleton pose' })).toBeVisible()
    await page.getByRole('button', { name: '3D', exact: true }).click()
    await expect(page.getByText(/^Yaw 0°, pitch 0°/)).toBeVisible()
    await scan(page, '3D pose view')
  })
})
