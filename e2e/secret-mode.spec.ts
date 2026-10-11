// Secret mode turned on after a run makes that run secret on the server: a
// reload no longer brings it back, as it does for an ordinary run.

import { expect, test, type Page } from '@playwright/test'

const result = (page: Page) => page.locator('img[alt^="Generated image, seed"]')

async function generateOnce(page: Page, prompt: string) {
  await page.goto('/')
  const generate = page.getByRole('button', { name: 'Generate', exact: true })
  await expect(generate).toBeEnabled()
  await page.locator('#prompt').fill(prompt)
  await generate.click()
  await expect(result(page)).toBeVisible()
}

/** Reloads and waits for the page to have asked the server for its run. */
async function reload(page: Page) {
  const asked = page.waitForResponse((response) => /\/api\/gen\/[^/]+\/job$/.test(new URL(response.url()).pathname))
  await page.reload()
  await asked
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled()
}

test('an ordinary run comes back after a reload', async ({ page }) => {
  await generateOnce(page, 'an ordinary run')
  await reload(page)
  await expect(result(page)).toBeVisible()
})

test('turned secret after it ran, a run does not come back', async ({ page }) => {
  await generateOnce(page, 'a run turned secret')
  const marked = page.waitForResponse((response) => response.url().includes('/job/secret') && response.request().method() === 'POST')
  const toggle = page.getByRole('button', { name: 'Secret mode' }).first()
  await toggle.click()
  expect((await marked).status()).toBe(200)
  // Turning it off again does not make the run ordinary.
  await toggle.click()
  await reload(page)
  await expect(result(page)).toHaveCount(0)
})
