// Browser tests: a production build of Latentry on its own port, pointed at a
// mock A1111 web UI (__tests__/fixtures/mock-a1111.ts). Run them with
// `npm run test:e2e` (scripts/e2e.mjs), which makes the temp folder with the
// settings and save folder this reads, and deletes it afterwards. Nothing
// here reads this computer's own settings, backends or pictures, and the page
// may not reach anything but this server.

import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

const root = process.env.E2E_ROOT
if (!root) throw new Error('Run the browser tests with `npm run test:e2e`, which sets up their temp folder.')
const port = Number(process.env.E2E_PORT)
const mockPort = Number(process.env.E2E_MOCK_PORT)
const ci = !!process.env.CI

export default defineConfig({
  testDir: 'e2e',
  // npm run docs:screenshots runs the shots for the guide instead of the tests.
  testMatch: process.env.DOCS_SHOTS ? '**/*.shots.ts' : '**/*.spec.ts',
  // One server and one backend: runs share them, so they go one at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: ci,
  retries: 0,
  timeout: 60_000,
  // Locally the traces stay in the temp folder; CI uploads them when a test fails.
  outputDir: ci ? 'test-results' : path.join(root, 'test-results'),
  reporter: ci ? [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: process.env.E2E_CHANNEL || undefined } }],
  webServer: [
    {
      command: 'node node_modules/ts-node/dist/bin.js --project __tests__/tsconfig.json e2e/mock-server.ts',
      url: `http://127.0.0.1:${mockPort}/sdapi/v1/progress`,
      env: { TS_NODE_TRANSPILE_ONLY: '1' },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `node scripts/serve.mjs build && node scripts/serve.mjs start -p ${port}`,
      url: `http://127.0.0.1:${port}/api/gen/backends`,
      env: {
        // A build of its own, so a running `npm start` keeps its .next.
        LATENTRY_DIST_DIR: '.next-e2e',
        LATENTRY_SETTINGS_FILE: path.join(root, 'settings.json'),
        // docs:screenshots on the real engine uses its installed runtime; otherwise the engine is off.
        ...(process.env.DOCS_ENGINE_RUNTIME
          ? { LATENTRY_RUNTIME_DIR: process.env.DOCS_ENGINE_RUNTIME, HF_HUB_OFFLINE: '1' }
          : { LATENTRY_RUNTIME_DIR: path.join(root, 'runtime'), LATENTRY_ENGINE: 'off' }),
        LATENTRY_HOST: '127.0.0.1',
        LATENTRY_NO_LOGO: '1',
        // The tests open pages and click far faster than a person, all from one
        // address: the per-minute budget stays on, with room for a whole run.
        REQUEST_BUDGET_PAGE_PER_MIN: '1200',
        REQUEST_BUDGET_API_PER_MIN: '3000',
        REQUEST_BUDGET_POST_PER_MIN: '300',
        REQUEST_BUDGET_GLOBAL_PER_MIN: '6000',
      },
      // Never a server already on the port: it would be someone's real one.
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
})
