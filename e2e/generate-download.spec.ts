// Saving from the Generate page (guide/generate.md#results): without its
// settings, cleaned in the page from the picture it already has, or with
// them, from the gallery's copy. The viewer has no save of its own.

import { readFileSync } from 'node:fs'
import { expect, test, type Download, type Page } from './test'

async function generateOnce(page: Page, prompt: string) {
  await page.goto('/')
  const generate = page.getByRole('button', { name: 'Generate', exact: true })
  await expect(generate).toBeEnabled()
  await page.locator('#prompt').fill(prompt)
  await generate.click()
  await expect(page.getByRole('link', { name: 'In gallery' })).toBeVisible()
}

async function bytesOf(download: Download): Promise<Buffer> {
  return readFileSync((await download.path())!)
}

test('a result saves without its settings, or with them from the gallery', async ({ page }) => {
  await generateOnce(page, 'generate download beacon')
  // Cleaning asks nothing of the server.
  const asked: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/')) asked.push(request.url())
  })
  const [clean] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save without settings' }).first().click()])
  expect(clean.suggestedFilename()).toMatch(/\.png$/)
  const cleanBytes = await bytesOf(clean)
  expect(cleanBytes.subarray(1, 4).toString()).toBe('PNG')
  expect(cleanBytes.includes(Buffer.from('generate download beacon'))).toBe(false)
  expect(cleanBytes.includes(Buffer.from('tEXt')) || cleanBytes.includes(Buffer.from('iTXt'))).toBe(false)
  expect(asked.filter((url) => url.includes('/api/gallery/'))).toEqual([])

  const [full] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save with settings' }).first().click()])
  const fullBytes = await bytesOf(full)
  expect(fullBytes.includes(Buffer.from('generate download beacon'))).toBe(true)
  expect(fullBytes.includes(Buffer.from('latentry'))).toBe(true)

  // Full screen: the same two in the panel, and no save of the viewer's own.
  await page.getByRole('button', { name: /^Generated image, seed/ }).first().click()
  await expect(page.locator('.pswp')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Save', exact: true })).toBeHidden()
  const inPanel = page.locator('.pswp').getByRole('button', { name: 'Save without settings' })
  if (!(await inPanel.isVisible())) await page.locator('.pswp').getByRole('button', { name: 'Details' }).click()
  const [fromViewer] = await Promise.all([page.waitForEvent('download'), inPanel.click()])
  expect((await bytesOf(fromViewer)).includes(Buffer.from('generate download beacon'))).toBe(false)
})
