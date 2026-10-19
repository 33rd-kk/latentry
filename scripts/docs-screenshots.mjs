// `npm run docs:screenshots`: retakes the guide's screenshots in
// docs/assets from a clean Latentry, as the browser tests run it (a production
// build of its own, the mock backends, the engine off; see
// playwright.config.ts), with e2e/screenshots/docs.shots.ts. Its gallery is
// made in a temp folder from public example pictures and drawn stand-ins, so
// nothing of this computer's settings, backends, folders or pictures can show;
// each shot is also checked for this computer's names and ports first. The
// temp folder is deleted afterwards.
//
//   E2E_CHANNEL=msedge   use an installed browser instead of Playwright's Chromium
//   DOCS_SHOTS_OUT       where the pictures go (docs/assets)
//   DOCS_SHOTS_ONLY      a part of a shot's name, to retake only those
//   E2E_KEEP=1           keep the temp folder (traces of failed shots) afterwards
//
// On the real engine (e2e/screenshots/engine.shots.ts) instead of the mocks:
//   DOCS_ENGINE_MODELS   a models folder for it, e.g. one of hard links to yours
//   DOCS_ENGINE_MODEL    the checkpoint in it to draw with
//   DOCS_ENGINE_RUNTIME  the installed engine (Latentry's .runtime folder)
//   DOCS_ENGINE_PORT     its port (7871, beside an engine you may run)
//   DOCS_ENGINE_TAGGER   the WD14 tagger folder inside it, e.g. wd14/wd-vit-tagger-v3
//   DOCS_COMFY_URL       a ComfyUI to show, with DOCS_COMFY_WORKFLOWS a workflows folder
// Stop your own engine first: two on one GPU may not fit.
//   E2E_PORT, E2E_MOCK_PORT, E2E_COMFY_PORT, E2E_POSE_PORT, E2E_POSE_SINGLE_PORT
//                        the ports, as for npm run test:e2e
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const port = process.env.E2E_PORT || '3137'
const mockPort = process.env.E2E_MOCK_PORT || '3138'
const comfyPort = process.env.E2E_COMFY_PORT || '3139'
const posePort = process.env.E2E_POSE_PORT || '3140'
const poseSinglePort = process.env.E2E_POSE_SINGLE_PORT || '3141'
const engineModels = process.env.DOCS_ENGINE_MODELS ? path.resolve(process.env.DOCS_ENGINE_MODELS) : null
if (engineModels && (!process.env.DOCS_ENGINE_MODEL || !process.env.DOCS_ENGINE_RUNTIME)) {
  console.error('DOCS_ENGINE_MODELS needs DOCS_ENGINE_MODEL and DOCS_ENGINE_RUNTIME too.')
  process.exit(2)
}
const root = mkdtempSync(path.join(tmpdir(), 'latentry-docs-'))
mkdirSync(path.join(root, 'out'))
// Ids as a reader would name their own backends; the kinds are the mocks'.
writeFileSync(
  path.join(root, 'settings.json'),
  JSON.stringify({
    version: 1,
    backends: engineModels
      ? process.env.DOCS_COMFY_URL
        ? [{ id: 'comfyui', kind: 'comfyui', url: process.env.DOCS_COMFY_URL, profile: 'illustrious', ...(process.env.DOCS_COMFY_WORKFLOWS ? { workflowsDir: process.env.DOCS_COMFY_WORKFLOWS } : {}) }]
        : []
      : [
          { id: 'forge', kind: 'a1111', url: `http://127.0.0.1:${mockPort}/`, profile: 'illustrious' },
          { id: 'comfyui', kind: 'comfyui', url: `http://127.0.0.1:${comfyPort}/`, profile: 'sdxl' },
          { id: 'diffusers', kind: 'diffusers', url: `http://127.0.0.1:${posePort}/`, profile: 'illustrious' },
        ],
    gallery: { saveDir: path.join(root, 'out'), dirs: [], autoTag: false },
    engine: engineModels
      ? { autoStart: true, modelsDir: engineModels, model: process.env.DOCS_ENGINE_MODEL, basePort: Number(process.env.DOCS_ENGINE_PORT || 7871) }
      : { autoStart: false },
    // The engine's models folder brings its tagger along, for the viewer's WD14 tags.
    ...(engineModels && process.env.DOCS_ENGINE_TAGGER ? { wd14: { modelDir: path.join(engineModels, process.env.DOCS_ENGINE_TAGGER) } } : {}),
  })
)

let status = 1
try {
  const result = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: {
      ...process.env,
      DOCS_SHOTS: '1',
      DOCS_SHOTS_OUT: path.resolve(process.env.DOCS_SHOTS_OUT || 'docs/assets'),
      E2E_ROOT: root,
      E2E_PORT: port,
      E2E_MOCK_PORT: mockPort,
      E2E_COMFY_PORT: comfyPort,
      E2E_POSE_PORT: posePort,
      E2E_POSE_SINGLE_PORT: poseSinglePort,
    },
  })
  status = result.status ?? 1
} finally {
  if (process.env.E2E_KEEP === '1') console.log(`Kept ${root}`)
  else rmSync(root, { recursive: true, force: true })
}
process.exit(status)
