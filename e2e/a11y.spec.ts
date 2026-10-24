// Accessibility: axe-core checks each page against WCAG 2.1 A and AA, in the
// light and the dark theme. A serious or critical finding fails the test;
// lesser ones are printed, so they can be looked at without blocking.
//
// axe runs inside the page and reads only the page: nothing is sent anywhere.

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const PAGES = [
  { path: '/', ready: (page: Page) => page.getByRole('button', { name: 'Generate', exact: true }) },
  { path: '/gallery', ready: (page: Page) => page.getByPlaceholder('Search prompts, tags, models, file names') },
  { path: '/settings', ready: (page: Page) => page.getByRole('heading', { name: 'Settings', exact: true }) },
  { path: '/setup', ready: (page: Page) => page.getByRole('heading', { name: 'Setup', exact: true }) },
  { path: '/pair', ready: (page: Page) => page.getByRole('textbox', { name: 'Code' }) },
]

async function scan(page: Page, label: string) {
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
