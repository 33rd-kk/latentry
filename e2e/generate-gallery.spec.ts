// Generate a picture on the mock backend, find it in the gallery, open it.

import { expect, test } from '@playwright/test'

const PROMPT = 'a lighthouse at dusk, browser run'

// Anything the page asks of another host is refused and remembered: the app
// should never need one.
const outside: string[] = []
test.beforeEach(async ({ context, baseURL }) => {
  const own = new URL(baseURL!).origin
  await context.route(
    (url) => url.origin !== own && url.protocol !== 'data:' && url.protocol !== 'blob:',
    (route) => {
      outside.push(route.request().url())
      return route.abort()
    }
  )
})
test.afterEach(() => {
  expect(outside, 'requests to other hosts').toEqual([])
})

test('a generated picture is saved and opens from the gallery', async ({ page }) => {
  await page.goto('/')
  const generate = page.getByRole('button', { name: 'Generate', exact: true })
  // Enabled once the page has seen the backend answer.
  await expect(generate).toBeEnabled()

  await page.locator('#prompt').fill(PROMPT)
  await generate.click()

  await expect(page.locator('img[alt^="Generated image, seed"]')).toBeVisible()
  const saved = page.getByRole('link', { name: 'In gallery' })
  await expect(saved).toBeVisible()
  await saved.click()

  await expect(page).toHaveURL(/\/gallery/)
  const folders = await page.request.get('/api/gallery')
  expect((await folders.json()).dirs, 'the temp save folder is the only folder').toHaveLength(1)
  const thumbs = page.locator('img[src^="/api/gallery/0/"][src*="thumb=1"]')
  await expect(thumbs).toHaveCount(1)
  await expect(thumbs.first()).toHaveJSProperty('complete', true)

  await thumbs.first().click()
  const close = page.getByRole('button', { name: 'Close', exact: true })
  await expect(close).toBeVisible()
  await expect(page.locator('img[src^="/api/gallery/0/"]:not([src*="thumb=1"])')).toBeVisible()
  await close.click()
  await expect(close).toBeHidden()
})
