// Playwright's `test`, with a page that fails its test when the page breaks
// the Content Security Policy (lib/security/headers.ts). Every spec imports
// `test` and `expect` from here, so a script, style or fetch the policy blocks
// fails the run in CI instead of quietly breaking a page.

import { expect, test as base } from '@playwright/test'

export * from '@playwright/test'

/** What a page said about the policy: console errors and violation events. */
const CSP_MESSAGE = /Content Security Policy|\[csp-violation\]/

export const test = base.extend({
  page: async ({ page }, provide, testInfo) => {
    const violations: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error' && CSP_MESSAGE.test(message.text())) violations.push(message.text())
    })
    // The event names what was blocked, also where the console says less.
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (event) => {
        console.error(`[csp-violation] ${event.violatedDirective} blocked ${event.blockedURI || 'inline'}`)
      })
    })
    await provide(page)
    if (testInfo.status === testInfo.expectedStatus) {
      expect(violations, 'the page broke its Content Security Policy').toEqual([])
    }
  },
})

export { expect }
