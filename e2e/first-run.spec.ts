// The first-run question (components/setup-notice.tsx): with no backend and
// no mode chosen, the generate page asks whether Latentry is for browsing only
// or for generating too, and saves the answer as the mode.

import { expect, test } from './test'
import { asFreshInstall } from './fresh-install'

test('a fresh install asks how it is used; "Browse only" turns on gallery-only mode', async ({ page, request }) => {
  await asFreshInstall(request, async () => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'What do you want to do with Latentry?' })).toBeVisible()
    await page.getByRole('button', { name: 'Browse only' }).click()

    // On to the gallery folders, in gallery-only mode.
    await expect(page).toHaveURL(/\/settings#gallery$/)
    await expect(page.getByRole('banner').getByRole('navigation').getByRole('link', { name: 'Generate' })).toHaveCount(0)
    const settings = await (await request.get('/api/settings')).json()
    expect(settings.mode.chosen).toBe('gallery')
  })
})

test('"Set up generating" shows the setup help, is not asked again, and can still turn to browsing only', async ({ page, request }) => {
  await asFreshInstall(request, async () => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Set up generating' }).click()
    await expect(page.getByText('Get drawing')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open setup' })).toBeVisible()
    expect((await (await request.get('/api/settings')).json()).mode.chosen).toBe('full')

    // Chosen: the next visit goes straight to the setup help.
    await page.reload()
    await expect(page.getByText('Get drawing')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'What do you want to do with Latentry?' })).toHaveCount(0)

    // Changed their mind: browsing only is still offered below the setup help.
    await page.getByRole('button', { name: 'Browse only instead' }).click()
    await expect(page).toHaveURL(/\/settings#gallery$/)
    expect((await (await request.get('/api/settings')).json()).mode.chosen).toBe('gallery')
  })
})

test('the E2E backends are back afterwards', async ({ request }) => {
  const { backends } = await (await request.get('/api/gen/backends')).json()
  expect(backends.length).toBeGreaterThan(0)
})
