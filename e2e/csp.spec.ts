// The Content Security Policy (lib/security/headers.ts) on the real pages:
// each page loads and works with it, and its scripts run only by the nonce of
// that one response. The page fixture in ./test fails a test on any
// violation, here and in every other spec.

import { test as unguarded } from '@playwright/test'
import { expect, test } from './test'

const PAGES = ['/', '/gallery', '/settings', '/setup', '/pair']

/** The nonce in a page response's policy. */
function nonceOf(csp: string): string | undefined {
  return /'nonce-([^']+)'/.exec(csp)?.[1]
}

test('every page gets a script policy with a nonce of its own', async ({ request }) => {
  const seen = new Set<string>()
  for (const path of PAGES) {
    for (let i = 0; i < 2; i++) {
      const csp = (await request.get(path)).headers()['content-security-policy'] ?? ''
      expect(csp, path).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'(;|$)/)
      expect(csp, `${path} allows eval`).not.toMatch(/unsafe-eval/)
      expect(csp, `${path} would push plain-http LAN use to https`).not.toMatch(/upgrade-insecure-requests/)
      const nonce = nonceOf(csp)!
      expect(seen.has(nonce), `${path} reused a nonce`).toBe(false)
      seen.add(nonce)
    }
  }
})

test('an API answer may load and run nothing', async ({ request }) => {
  const csp = (await request.get('/api/gen/backends')).headers()['content-security-policy'] ?? ''
  expect(csp).toMatch(/default-src 'none'/)
  expect(csp).not.toMatch(/script-src/)
})

test('a client cannot choose the nonce', async ({ request }) => {
  const response = await request.get('/', { headers: { 'x-nonce': 'chosen', 'content-security-policy': "script-src 'nonce-chosen'" } })
  const csp = response.headers()['content-security-policy'] ?? ''
  expect(nonceOf(csp)).not.toBe('chosen')
  expect(await response.text()).not.toContain('nonce="chosen"')
})

test('the pages run under the policy: every script carries the nonce', async ({ page }) => {
  for (const path of PAGES) {
    const response = await page.goto(path)
    const nonce = nonceOf(response!.headers()['content-security-policy'] ?? '')
    // The browser hides a nonce from the attribute once the page runs; the
    // property keeps it.
    const scripts = await page.evaluate(() => [...document.scripts].map((script) => ({ src: script.src, nonce: script.nonce })))
    expect(scripts.length, path).toBeGreaterThan(0)
    for (const script of scripts.filter((s) => !s.src)) expect(script.nonce, `${path}: an inline script without the nonce`).toBe(nonce)
  }
})

// Without the guard: this test breaks the policy on purpose, to show that
// markup slipped into a page (say a prompt shown as HTML) runs no script and
// loads nothing from elsewhere, and that the guard would see it. A script that
// is already running may still add scripts ('strict-dynamic'); the policy is
// about markup, which is how a prompt would get in.
unguarded('markup slipped into a page runs no script, and is reported', async ({ page }) => {
  const reported: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' && /Content Security Policy/.test(message.text())) reported.push(message.text())
  })
  await page.goto('/gallery')
  const result = await page.evaluate(async () => {
    const seen: string[] = []
    document.addEventListener('securitypolicyviolation', (event) => seen.push(event.violatedDirective))
    const slipped = document.createElement('div')
    slipped.innerHTML = '<img src="missing.png" onerror="window.__injected = true"><img src="https://example.com/x.png">'
    document.body.append(slipped)
    // A parser-inserted script, as a page written from text would get.
    const frame = document.implementation.createHTMLDocument('')
    frame.write('<script>window.__injected = true<\/script>')
    await new Promise((resolve) => setTimeout(resolve, 1000))
    return { ran: (window as unknown as { __injected?: boolean }).__injected === true, seen: [...new Set(seen)].sort() }
  })
  expect(result.ran).toBe(false)
  expect(result.seen).toEqual(expect.arrayContaining(['img-src', 'script-src-attr']))
  await expect.poll(() => reported.length).toBeGreaterThan(0)
})

test('the theme switch and a toast work under the policy', async ({ page }) => {
  await page.goto('/')
  const html = page.locator('html')
  const dark = (await html.getAttribute('class'))?.includes('dark') ?? false
  await page.getByRole('button', { name: 'Light / dark' }).click()
  await expect(html).toHaveClass(dark ? /^(?!.*\bdark\b)/ : /\bdark\b/)
  // Generate with no prompt shows a toast, whose styles sonner adds at run time.
  await page.getByRole('button', { name: 'Generate', exact: true }).click()
  await expect(page.getByText('Prompt is required')).toBeVisible()
})
