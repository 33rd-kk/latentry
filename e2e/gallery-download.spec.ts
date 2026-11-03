// Saving from the gallery (guide/gallery.md#saving-and-sharing): without its
// settings unless asked, one picture from the viewer's panel or several as a
// ZIP from the selection. Other tests save pictures to the same folder, so
// this one finds its own by searching for their prompts.

import { readFileSync } from 'node:fs'
import { expect, test, type Download, type Page } from '@playwright/test'

async function generateOnce(page: Page, prompt: string) {
  await page.goto('/')
  const generate = page.getByRole('button', { name: 'Generate', exact: true })
  await expect(generate).toBeEnabled()
  await page.locator('#prompt').fill(prompt)
  const asked = page.waitForResponse((response) => response.url().endsWith('/generate') && response.request().method() === 'POST')
  await generate.click()
  await asked
  await expect(page.getByRole('link', { name: 'In gallery' })).toBeVisible()
}

async function bytesOf(download: Download): Promise<Buffer> {
  return readFileSync((await download.path())!)
}

test('a picture is saved without its settings unless asked', async ({ page }) => {
  await generateOnce(page, 'download spec beacon')
  await generateOnce(page, 'download spec harbour')
  await page.goto('/gallery')
  const thumbs = page.locator('img[src^="/api/gallery/0/"][src*="thumb=1"]')
  await page.getByPlaceholder('Search prompts, tags, models, file names').fill('download spec')
  // The suggestions would cover the pictures: closed, as a person would.
  await page.keyboard.press('Escape')
  await expect(thumbs).toHaveCount(2)

  await thumbs.first().click()
  const clean = page.getByRole('button', { name: 'Save without settings' })
  if (!(await clean.isVisible())) await page.getByRole('button', { name: 'Details' }).click()
  // No save button of the viewer's own: it would save the settings too.
  await expect(page.getByRole('link', { name: 'Save', exact: true })).toBeHidden()

  const [cleanDownload] = await Promise.all([page.waitForEvent('download'), clean.click()])
  expect(cleanDownload.suggestedFilename()).toMatch(/\.png$/)
  const cleanBytes = await bytesOf(cleanDownload)
  expect(cleanBytes.subarray(1, 4).toString()).toBe('PNG')
  expect(cleanBytes.includes(Buffer.from('download spec'))).toBe(false)
  expect(cleanBytes.includes(Buffer.from('tEXt'))).toBe(false)

  const [fullDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save with settings' }).click()])
  expect((await bytesOf(fullDownload)).includes(Buffer.from('download spec'))).toBe(true)
  await page.keyboard.press('Escape')

  // Both at once, as a ZIP.
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  await page.getByRole('button', { name: 'Select all 2' }).click()
  const [zip] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download 2 without settings' }).click()])
  expect(zip.suggestedFilename()).toBe('latentry-pictures.zip')
  const zipBytes = await bytesOf(zip)
  expect(zipBytes.subarray(0, 4).readUInt32LE(0)).toBe(0x04034b50)
  expect(zipBytes.includes(Buffer.from('download spec'))).toBe(false)
  const [withSettings] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'With settings', exact: true }).click()])
  expect((await bytesOf(withSettings)).includes(Buffer.from('download spec'))).toBe(true)
})
