// `npm run test:e2e`: the browser tests in e2e/, against a production build of
// Latentry, a mock A1111 web UI and a mock ComfyUI (see playwright.config.ts). This makes a
// temp folder for the run's settings, saved pictures and traces, runs
// Playwright, and deletes the folder again, so a run leaves nothing behind.
// Arguments go on to `playwright test`.
//
//   E2E_CHANNEL=msedge   use an installed browser instead of Playwright's Chromium
//   E2E_KEEP=1           keep the temp folder (traces of failed tests) afterwards
//   E2E_PORT, E2E_MOCK_PORT, E2E_COMFY_PORT   the ports (3137, 3138, 3139)
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const port = process.env.E2E_PORT || '3137'
const mockPort = process.env.E2E_MOCK_PORT || '3138'
const comfyPort = process.env.E2E_COMFY_PORT || '3139'
const root = mkdtempSync(path.join(tmpdir(), 'latentry-e2e-'))
mkdirSync(path.join(root, 'out'))
// One workflow, as ComfyUI's Export (API) writes it, for the ComfyUI backend's folder.
mkdirSync(path.join(root, 'workflows'))
writeFileSync(
  path.join(root, 'workflows', 'portrait.json'),
  JSON.stringify({
    4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'base.safetensors' } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['4', 1] } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['4', 1] } },
    5: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
    3: {
      class_type: 'KSampler',
      inputs: { seed: 1, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] },
    },
    8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    9: { class_type: 'SaveImage', inputs: { filename_prefix: 'ComfyUI', images: ['8', 0] } },
  })
)
writeFileSync(
  path.join(root, 'settings.json'),
  JSON.stringify({
    version: 1,
    // A backends list replaces GEN_BACKENDS and the rest of .env.local's.
    backends: [
      { id: 'mock', kind: 'a1111', url: `http://127.0.0.1:${mockPort}/`, profile: 'generic' },
      { id: 'comfy', kind: 'comfyui', url: `http://127.0.0.1:${comfyPort}/`, profile: 'sdxl', workflowsDir: path.join(root, 'workflows') },
    ],
    gallery: { saveDir: path.join(root, 'out'), dirs: [], autoTag: false },
    engine: { autoStart: false },
  })
)

let status = 1
try {
  const result = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, E2E_ROOT: root, E2E_PORT: port, E2E_MOCK_PORT: mockPort, E2E_COMFY_PORT: comfyPort },
  })
  status = result.status ?? 1
} finally {
  if (process.env.E2E_KEEP === '1') console.log(`Kept ${root}`)
  else rmSync(root, { recursive: true, force: true })
}
process.exit(status)
