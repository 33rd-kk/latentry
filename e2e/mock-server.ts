// The mock A1111 web UI as a process of its own, for playwright.config.ts to
// start and stop alongside Latentry.

import { startMockA1111 } from '../__tests__/fixtures/mock-a1111'

startMockA1111({ port: Number(process.env.E2E_MOCK_PORT) || 3138 }).then((mock) => {
  console.log(`Mock A1111 web UI on ${mock.url}`)
})
