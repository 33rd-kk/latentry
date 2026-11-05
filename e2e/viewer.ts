// The gallery viewer's side panel, shared by the specs and the screenshots.

import { expect, type Page } from '@playwright/test'

/**
 * Opens the viewer's side panel unless it is open already. The viewer
 * remembers the panel in this browser, and its contents render a moment after
 * the viewer opens, so whether they are visible yet says nothing: the
 * **Details** button's pressed state, set as the viewer opens, does.
 */
export async function openViewerPanel(page: Page) {
  const details = page.getByRole('button', { name: 'Details' })
  await expect(details).toBeVisible()
  if ((await details.getAttribute('aria-pressed')) !== 'true') await details.click()
  await expect(details).toHaveAttribute('aria-pressed', 'true')
}
