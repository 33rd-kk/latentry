// What docs/guide/threat-model.md and network.md say the server does with a
// request, checked from outside the browser where that is closer to an
// attacker's view.

import { expect, test } from '@playwright/test'

// "Pages cannot be framed by other sites"; "Pages are not cached by the browser."
test('pages refuse framing and are not cached', async ({ request }) => {
  for (const path of ['/', '/gallery', '/settings']) {
    const response = await request.get(path)
    const headers = response.headers()
    const framing = headers['x-frame-options'] ?? ''
    const csp = headers['content-security-policy'] ?? ''
    expect(framing.toUpperCase() === 'DENY' || /frame-ancestors 'none'/.test(csp), `${path} can be framed`).toBe(true)
    expect(headers['cache-control'] ?? '', `${path} may be cached`).toMatch(/no-store/)
  }
})

// "/api accepts request bodies only as JSON."
test('the API refuses a body that is not JSON', async ({ request }) => {
  const response = await request.post('/api/gen/mock/generate', {
    headers: { 'content-type': 'text/plain' },
    data: '{"prompt":"not json"}',
  })
  expect(response.status()).toBeGreaterThanOrEqual(400)
  expect(response.status()).toBeLessThan(500)
})

// "refuses cross-site requests"
test('the API refuses a cross-site request', async ({ request }) => {
  const response = await request.post('/api/gen/mock/generate', {
    headers: { 'content-type': 'application/json', origin: 'https://example.com', 'sec-fetch-site': 'cross-site' },
    data: { prompt: 'cross site' },
  })
  expect(response.status()).toBe(403)
})

// network.md: another device opens "Pair this device", types the code and
// an optional name, then Pair.
test('the pairing page asks for the code and a name', async ({ page }) => {
  await page.goto('/pair')
  await expect(page.getByText('Pair this device').first()).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Code' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Name for this device (optional)' })).toHaveAttribute('placeholder', 'e.g. My phone')
  await expect(page.getByRole('button', { name: 'Pair', exact: true })).toBeVisible()
})

// "Settings, Setup and the pairing card": the card offers a one-time code.
test('the pairing card makes a code that works for 10 minutes', async ({ page }) => {
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Add a device' }).click()
  await expect(page.getByText(/It works once, for (9:5\d|10:00) more\./)).toBeVisible()
})
