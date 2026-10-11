// `npm run test:e2e`: the browser tests in e2e/, against a production build of
// Latentry and a mock A1111 web UI (see playwright.config.ts). This makes a
// temp folder for the run's settings, saved pictures and traces, runs
// Playwright, and deletes the folder again, so a run leaves nothing behind.
// Arguments go on to `playwright test`.
//
//   E2E_CHANNEL=msedge   use an installed browser instead of Playwright's Chromium
//   E2E_KEEP=1           keep the temp folder (traces of failed tests) afterwards
//   E2E_PORT, E2E_MOCK_PORT   the two ports (3137, 3138)
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const port = process.env.E2E_PORT || '3137'
const mockPort = process.env.E2E_MOCK_PORT || '3138'
const root = mkdtempSync(path.join(tmpdir(), 'latentry-e2e-'))
mkdirSync(path.join(root, 'out'))
writeFileSync(
  path.join(root, 'settings.json'),
  JSON.stringify({
    version: 1,
    // A backends list replaces GEN_BACKENDS and the rest of .env.local's.
    backends: [{ id: 'mock', kind: 'a1111', url: `http://127.0.0.1:${mockPort}/`, profile: 'generic' }],
    gallery: { saveDir: path.join(root, 'out'), dirs: [], autoTag: false },
    engine: { autoStart: false },
  })
)

let status = 1
try {
  const result = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, E2E_ROOT: root, E2E_PORT: port, E2E_MOCK_PORT: mockPort },
  })
  status = result.status ?? 1
} finally {
  if (process.env.E2E_KEEP === '1') console.log(`Kept ${root}`)
  else rmSync(root, { recursive: true, force: true })
}
process.exit(status)
