// docs/reference/backends.md#stablediffusioncpp: a picture drawn on a
// stable-diffusion.cpp sd-server (here the mock, "cpp") lands in the gallery
// with its settings, and Cancel stops that run's own job on the server.

import { expect, test, type Page } from './test'
import { MOCK_SDCPP_MODEL, SDCPP_HOLD } from '../__tests__/fixtures/mock-sdcpp'

const mock = `http://127.0.0.1:${process.env.E2E_SDCPP_PORT || '3142'}`

async function openOnCpp(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled()
  // The backend select is the first one in the page's main area (the header has the language menu).
  await page.getByRole('main').getByRole('combobox').first().click()
  await page.getByRole('option').filter({ has: page.getByText('cpp', { exact: true }) }).click()
  await expect(page.getByText(MOCK_SDCPP_MODEL)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled()
}

test('a picture drawn on sd.cpp is saved with its settings', async ({ page }) => {
  await openOnCpp(page)
  const prompt = 'a lighthouse at dusk, sdcpp run'
  await page.locator('#prompt').fill(prompt)
  await page.getByRole('button', { name: 'Generate', exact: true }).click()

  await expect(page.locator('img[alt^="Generated image, seed"]')).toBeVisible()
  await expect(page.getByRole('link', { name: 'In gallery' })).toBeVisible()

  // The saved picture's settings, as the gallery reads them back.
  const list = await page.request.get(`/api/gallery?dir=0&q=${encodeURIComponent('sdcpp run')}`)
  const pictures = (await list.json()).items as { meta?: { prompt?: string; model?: string } }[]
  expect(pictures, 'the picture is in the gallery').toHaveLength(1)
  expect(pictures[0].meta?.prompt).toBe(prompt)
  expect(pictures[0].meta?.model, 'the model is named by its file, without a folder').toBe(MOCK_SDCPP_MODEL)
})

test('Cancel stops the run’s own job on the server', async ({ page }) => {
  await openOnCpp(page)
  const before = (await (await page.request.get(`${mock}/mock/cancelled`)).json()).cancelled as string[]
  await page.locator('#prompt').fill(`held on sd.cpp ${SDCPP_HOLD}`)
  await page.getByRole('button', { name: 'Generate', exact: true }).click()
  const cancel = page.getByRole('button', { name: 'Cancel', exact: true })
  await expect(cancel).toBeVisible()
  await cancel.click()
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled()
  await expect(page.locator('img[alt^="Generated image, seed"]')).toHaveCount(0)
  const after = (await (await page.request.get(`${mock}/mock/cancelled`)).json()).cancelled as string[]
  expect(after.length - before.length, 'one job cancelled, by its id').toBe(1)
})
