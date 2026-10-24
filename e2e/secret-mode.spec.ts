// Secret mode turned on after a run makes that run secret on the server: a
// reload no longer brings it back, as it does for an ordinary run.

import { expect, test, type Page } from '@playwright/test'

const result = (page: Page) => page.locator('img[alt^="Generated image, seed"]')

async function generateOnce(page: Page, prompt: string) {
  await page.goto('/')
  const generate = page.getByRole('button', { name: 'Generate', exact: true })
  await expect(generate).toBeEnabled()
  await page.locator('#prompt').fill(prompt)
  // The page may still show the last run (it picks one up on load) until
  // this one has been asked for.
  const asked = page.waitForResponse((response) => response.url().endsWith('/generate') && response.request().method() === 'POST')
  await generate.click()
  await asked
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

/** Every value the page keeps in localStorage, joined, to look for typed text in. */
const stored = (page: Page) => page.evaluate(() => Object.values(localStorage).join('\n'))

// guide/secret-mode.md: nothing typed is kept in the browser, and a page that
// has been in secret mode remembers nothing of its runs when you go to the
// gallery and back, even once secret mode is off again: it may hold secret
// runs, which belong to that page only.
test('in secret mode, typing is not kept and the runs are not remembered', async ({ page }) => {
  await generateOnce(page, 'secret spec first run')
  // The second on the same page, so the first moves below into Earlier.
  await page.locator('#prompt').fill('secret spec second run')
  await page.getByRole('button', { name: 'Generate', exact: true }).click()
  const earlier = page.getByRole('region', { name: 'Earlier' })
  await expect(earlier).toContainText('secret spec first run')
  // Without secret mode, a typed prompt is kept for next time.
  await page.locator('#prompt').fill('secret spec kept text')
  await expect.poll(() => stored(page)).toContain('secret spec kept text')

  const toggle = page.getByRole('button', { name: 'Secret mode' }).first()
  await toggle.click()
  await page.locator('#prompt').fill('secret spec typed in secret')
  // Give a save the time it would take, then look.
  await page.waitForTimeout(1000)
  expect(await stored(page)).not.toContain('secret spec typed in secret')

  // Runs made now, then secret mode off, then away and back within the app
  // (not a reload): the page comes back without them.
  await page.locator('#prompt').fill('secret spec run in secret')
  await page.getByRole('button', { name: 'Generate', exact: true }).click()
  // Both ordinary runs are below it now (their prompts hidden in secret mode).
  await expect(earlier.locator(':scope > div')).toHaveCount(2)
  // One more, so the secret run moves below too.
  await page.locator('#prompt').fill('secret spec second secret run')
  await page.getByRole('button', { name: 'Generate', exact: true }).click()
  await expect(earlier.locator(':scope > div')).toHaveCount(3)
  await toggle.click()
  await page.getByRole('link', { name: 'Gallery' }).first().click()
  await expect(page).toHaveURL(/\/gallery/)
  await page.getByRole('link', { name: 'Generate' }).first().click()
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled()
  await expect(earlier).toHaveCount(0)
  expect(await stored(page)).not.toContain('secret spec run in secret')
})
