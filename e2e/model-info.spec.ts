// Model info: the link and recommended settings kept for the backend's
// checkpoint (the mock A1111's mock-model.safetensors), applied to the form
// only when asked, and sent with the next run.

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type Request } from '@playwright/test'

const generateButton = (page: Page) => page.getByRole('button', { name: 'Generate', exact: true })
const editor = (page: Page) => page.getByRole('group', { name: 'Info for mock-model.safetensors' })
const card = (page: Page) => page.getByRole('group', { name: 'Model info' })

// The specs share one settings folder: leave no info behind for the next ones.
test.afterEach(async ({ request }) => {
  await request.delete('/api/models/info?name=mock-model.safetensors')
  await request.delete('/api/models/info?name=other-model.safetensors')
})

test('model info is saved, applied on request, and sent with the run', async ({ page }) => {
  await page.goto('/')
  await expect(generateButton(page)).toBeEnabled()

  await page.getByRole('button', { name: 'Add model info' }).click()
  await editor(page).getByRole('button', { name: 'Use current values' }).click()
  await expect(editor(page).getByLabel('Steps')).not.toHaveValue('')
  // The backend's own "Default" is not a recommendation, so it is left out.
  await expect(editor(page).getByLabel('Sampler')).toHaveValue('')
  await editor(page).getByLabel('Sampler').fill('Euler')
  await editor(page).getByLabel('Where it came from (link)').fill('https://example.com/models/mock')
  await editor(page).getByLabel('Steps').fill('33')
  await editor(page).getByLabel('CFG').fill('4.5')
  await editor(page).getByLabel('Width').fill('832')
  await editor(page).getByLabel('Height').fill('1216')
  await editor(page).getByLabel('Scheduler').fill('Exponential')
  await editor(page).getByLabel('Notes').fill('From its page')

  const { violations } = await new AxeBuilder({ page }).include('[role="group"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(violations.filter((item) => item.impact === 'serious' || item.impact === 'critical').map((item) => item.id), 'the editor: serious or critical findings').toEqual([])

  await editor(page).getByRole('button', { name: 'Save' }).click()
  await expect(card(page)).toContainText('Euler · Exponential · 33 steps · CFG 4.5 · 832×1216')
  const link = card(page).getByRole('link', { name: 'example.com' })
  await expect(link).toHaveAttribute('href', 'https://example.com/models/mock')
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer')

  // Kept on the server, and saving changed nothing on the form.
  await page.reload()
  await expect(generateButton(page)).toBeEnabled()
  await expect(card(page)).toContainText('33 steps')
  await expect(page.getByText(/^Steps: 33/)).toHaveCount(0)

  await card(page).getByRole('button', { name: 'Apply recommended' }).click()
  await expect(page.getByText('Not offered by this backend, so left as it was: Exponential')).toBeVisible()
  await expect(page.getByText(/^Steps: 33/)).toBeVisible()

  await page.locator('#prompt').fill(`model info spec ${Date.now()}`)
  const sent = page.waitForRequest((request: Request) => request.method() === 'POST' && request.url().endsWith('/generate'))
  await generateButton(page).click()
  const body = (await sent).postDataJSON() as Record<string, unknown>
  // The scheduler the backend lacks was left as it was: its Default.
  expect([body.num_inference_steps, body.guidance_scale, body.width, body.height, body.sampler, body.scheduler]).toEqual([33, 4.5, 832, 1216, 'Euler', 'Default'])
  await expect(page.getByRole('link', { name: 'In gallery' })).toBeVisible()

  await card(page).getByRole('button', { name: 'Edit model info' }).click()
  await editor(page).getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByRole('button', { name: 'Add model info' })).toBeVisible()
})

test('a bad link is refused by name', async ({ page }) => {
  await page.goto('/')
  await expect(generateButton(page)).toBeEnabled()
  await page.getByRole('button', { name: 'Add model info' }).click()
  await editor(page).getByLabel('Where it came from (link)').fill('javascript:alert(1)')
  await editor(page).getByRole('button', { name: 'Save' }).click()
  await expect(editor(page).getByText('A link starting with http:// or https://.')).toBeVisible()
})

test('Settings lists every model kept, and adds one that is not loaded', async ({ page, request }) => {
  await request.delete('/api/models/info?name=other-model.safetensors')
  await page.goto('/settings#models')
  await expect(page.getByRole('tab', { name: /^Model info/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('No model info kept yet.')).toBeVisible()

  // A model the backends do not have loaded: only reachable here.
  await page.getByLabel('Add info for a model').fill('other-model.safetensors')
  await page.getByRole('button', { name: 'Add model info' }).click()
  const otherEditor = page.getByRole('group', { name: 'Info for other-model.safetensors' })
  await expect(otherEditor.getByRole('button', { name: 'Use current values' })).toHaveCount(0)
  await otherEditor.getByLabel('Steps').fill('20')
  await otherEditor.getByLabel('Where it came from (link)').fill('https://example.com/other')
  await otherEditor.getByRole('button', { name: 'Save' }).click()

  const list = page.getByRole('list', { name: 'Model info' })
  await expect(list.getByRole('listitem')).toHaveCount(1)
  await expect(list).toContainText('other-model.safetensors')
  await expect(list).toContainText('20 steps')
  await expect(list.getByRole('link', { name: 'example.com' })).toHaveAttribute('rel', 'noopener noreferrer')
  // Saved at once: nothing waits for the page's Save button.
  await expect(page.getByText('Unsaved changes')).toHaveCount(0)

  const { violations } = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(violations.filter((item) => item.impact === 'serious' || item.impact === 'critical').map((item) => item.id), 'the section: serious or critical findings').toEqual([])

  await list.getByRole('button', { name: 'Edit the info for other-model.safetensors' }).click()
  await otherEditor.getByLabel('Steps').fill('24')
  await otherEditor.getByRole('button', { name: 'Save' }).click()
  await expect(list).toContainText('24 steps')

  await list.getByRole('button', { name: 'Edit the info for other-model.safetensors' }).click()
  await otherEditor.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText('No model info kept yet.')).toBeVisible()
})
