// A ComfyUI backend's own workflow, picked on the Generate page from its
// folder (scripts/e2e.mjs puts portrait.json there), drawn on the mock ComfyUI.

import { expect, test } from '@playwright/test'

test('a workflow from the folder is offered, and draws a picture', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled()

  // The backend select is the first one in the page's main area (the header has the language menu).
  await page.getByRole('main').getByRole('combobox').first().click()
  await page.getByRole('option').filter({ hasText: 'comfyui' }).click()

  const picker = page.getByRole('combobox', { name: 'Workflow' })
  await expect(picker).toBeVisible()
  await picker.click()
  await page.getByRole('option', { name: 'portrait', exact: true }).click()
  await expect(page.getByText('A workflow draws from the prompt only')).toBeVisible()

  await page.locator('#prompt').fill('a harbour at dawn')
  const generate = page.getByRole('button', { name: 'Generate', exact: true })
  await expect(generate).toBeEnabled()
  await generate.click()
  await expect(page.locator('img[alt^="Generated image, seed"]')).toBeVisible()
  await expect(page.getByRole('link', { name: 'In gallery' })).toBeVisible()
})
