// The Setup page with a made-up engine status: the browser answers
// /api/engine itself, so these tests need no engine, GPU or download, and
// each button's request is caught and recorded rather than sent on.

import { expect, test, type Page } from '@playwright/test'

const entry = (id: string, kind: 'checkpoint' | 'tagger', extra: Record<string, unknown> = {}) => ({
  id,
  kind,
  name: `Test ${kind} ${id}`,
  repo: `example/${id}`,
  revision: '0'.repeat(40),
  bytes: 2 * 1024 ** 3,
  license: 'Test license',
  licenseUrl: 'https://example.invalid/license',
  commercialOutputs: true,
  terms: 'Test terms.',
  modelId: id,
  installed: false,
  inUse: false,
  dir: null,
  download: null,
  ...extra,
})

function status(running: boolean) {
  return {
    editable: true,
    platform: 'test platform',
    gpus: [{ index: 0, vendor: 'nvidia', name: 'Test GPU', vramMiB: 16384, driver: '999.1', computeCap: '12.0' }],
    torch: { indexUrl: null, backend: 'cu130', label: 'CUDA 13.0' },
    runtimeDir: 'runtime-folder',
    modelsDir: 'models-folder',
    customModelsDir: null,
    autoStart: false,
    shareLoras: false,
    basePort: 7860,
    installed: {
      torch: '2.0.0',
      indexUrl: null,
      installedAt: '2026-10-01T00:00:00Z',
      lock: { name: 'test-lock', lockedOn: '2026-10-01' },
      unpinned: null,
      check: { torch: '2.0.0', diffusers: '0.40.0', device: 'cuda', gpu: 'Test GPU' },
    },
    install: { state: 'idle', step: null, error: null, log: [] },
    engines: [
      { id: 'engine-0', gpu: 'Test GPU', port: 7860, state: running ? 'running' : 'stopped', pid: null, model: running ? 'loaded.safetensors' : null, loading: null, loadError: null, restarts: 0, log: ['engine log line'] },
    ],
    models: running
      ? [
          { id: 'loaded.safetensors', name: 'Loaded model', family: 'sdxl', sizeBytes: 6 * 1024 ** 3 },
          { id: 'other.safetensors', name: 'Other model', family: 'sdxl', sizeBytes: 6 * 1024 ** 3 },
        ]
      : null,
    current: running ? 'loaded.safetensors' : null,
    catalog: [entry('ckpt', 'checkpoint'), entry('tagger', 'tagger', { installed: true, dir: 'tagger-folder' })],
  }
}

/** Answers the engine and settings calls in the browser; returns what was asked. */
async function fakeEngine(page: Page) {
  const state = { running: false }
  const calls: { method: string; path: string; body: unknown }[] = []
  await page.route(/\/api\/(engine|settings)(\/.*)?$/, async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === 'GET' && path === '/api/engine') return route.fulfill({ json: status(state.running) })
    if (request.method() === 'GET') return route.fallback()
    calls.push({ method: request.method(), path, body: request.postDataJSON() })
    if (path === '/api/engine/start') state.running = true
    if (path === '/api/engine/stop') state.running = false
    return route.fulfill({ json: {} })
  })
  return { state, calls }
}

test('the engine card: start, stop and the switches', async ({ page }) => {
  const { calls } = await fakeEngine(page)
  await page.goto('/setup')

  await expect(page.getByRole('heading', { name: 'Setup' })).toBeVisible()
  await expect(page.getByText('GPU 0: Test GPU · 16 GB · driver 999.1')).toBeVisible()
  await expect(page.getByText('PyTorch build: CUDA 13.0')).toBeVisible()
  await expect(page.getByText('PyTorch 2.0.0 and diffusers 0.40.0, running on Test GPU.')).toBeVisible()
  await expect(page.getByText('Stopped', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(page.getByText('Running', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(page.getByText('Stopped', { exact: true })).toBeVisible()
  expect(calls.map((call) => call.path)).toEqual(['/api/engine/start', '/api/engine/stop'])

  await page.getByRole('button', { name: 'Log' }).click()
  await expect(page.getByText('engine log line')).toBeVisible()

  await page.getByRole('switch', { name: 'Start the engine with Latentry' }).click()
  await expect.poll(() => calls.at(-1)).toEqual({ method: 'PUT', path: '/api/settings', body: { engine: { autoStart: true } } })

  // generate.md and network.md send people here for the LoRA list on paired devices.
  await page.getByRole('switch', { name: 'Show the LoRA list on paired devices' }).click()
  await expect.poll(() => calls.at(-1)).toEqual({ method: 'PUT', path: '/api/settings', body: { engine: { shareLoras: true } } })
})

test('packages installed with LATENTRY_ENGINE_PACKAGES=latest are said to be unpinned', async ({ page }) => {
  await fakeEngine(page)
  // Registered last, so it answers before the fake above.
  await page.route(/\/api\/engine$/, (route) => {
    const unpinned = status(false)
    unpinned.installed.unpinned = 'latest' as never
    unpinned.installed.lock = null as never
    return route.fulfill({ json: unpinned })
  })
  await page.goto('/setup')
  await expect(page.getByText(/^Python packages are the newest ones, not pinned \(LATENTRY_ENGINE_PACKAGES=latest\)/)).toBeVisible()
})

test('models: load one, download after accepting, choose a tagger, set the folder', async ({ page }) => {
  const { state, calls } = await fakeEngine(page)
  state.running = true
  await page.goto('/setup')

  await expect(page.getByText('Loaded', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Load', exact: true }).click()
  await expect.poll(() => calls.at(-1)).toEqual({ method: 'POST', path: '/api/engine/models/load', body: { id: 'other.safetensors' } })

  const download = page.getByRole('button', { name: 'Download · 2.0 GB' })
  await expect(download).toBeDisabled()
  await page.getByLabel('I have read the license and accept it').check()
  await download.click()
  await expect.poll(() => calls.at(-1)).toEqual({ method: 'POST', path: '/api/engine/models/download', body: { id: 'ckpt' } })

  await page.getByRole('button', { name: 'Use this one' }).click()
  await expect.poll(() => calls.at(-1)).toEqual({ method: 'PUT', path: '/api/settings', body: { wd14: { modelDir: 'tagger-folder' } } })

  // A new folder restarts the running engine, which reads it when it starts.
  await page.getByLabel('Models folder').fill('another-folder')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect
    .poll(() => calls.slice(-3).map((call) => [call.path, call.body]))
    .toEqual([
      ['/api/settings', { engine: { modelsDir: 'another-folder' } }],
      ['/api/engine/stop', {}],
      ['/api/engine/start', {}],
    ])
})

test('models: check a Hugging Face URL, then download that commit as a LoRA', async ({ page }) => {
  const { state, calls } = await fakeEngine(page)
  state.running = true
  const commit = 'abcdef0123456789abcdef0123456789abcdef01'
  const url = 'https://huggingface.co/someone/style/blob/main/style.safetensors'
  // Registered last, so they answer before the fake above.
  await page.route(/\/api\/engine\/models\/hf$/, (route) => {
    const typed = route.request().postDataJSON().url
    if (typed !== url) return route.fulfill({ status: 400, json: { error: 'i18n:setup.hf.error.notSafetensors' } })
    return route.fulfill({
      json: { repo: 'someone/style', path: 'style.safetensors', fileName: 'style.safetensors', commit, sha256: 'f'.repeat(64), size: 150 * 1024 ** 2, license: 'mit', gated: false, token: false },
    })
  })
  await page.route(/\/api\/engine$/, (route) =>
    route.fulfill({
      json: {
        ...status(true),
        urlDownloads: [{ id: 'd1', repo: 'other/model', fileName: 'broken.safetensors', folder: 'checkpoint', state: 'error', doneBytes: 0, totalBytes: 0, error: 'did not match' }],
      },
    })
  )
  await page.goto('/setup')

  await expect(page.getByText('broken.safetensors')).toBeVisible()
  await expect(page.getByText('Download failed: did not match')).toBeVisible()

  const field = page.getByLabel('Download by Hugging Face URL')
  await field.fill('https://huggingface.co/someone/style/blob/main/style.ckpt')
  await page.getByRole('button', { name: 'Check', exact: true }).click()
  await expect(page.getByText(/^Only \.safetensors files are downloaded/)).toBeVisible()

  await field.fill(url)
  await page.getByRole('button', { name: 'LoRA', exact: true }).click()
  await page.getByRole('button', { name: 'Check', exact: true }).click()
  await expect(page.getByText('someone/style · commit abcdef0123')).toBeVisible()
  await expect(page.getByText('License: mit')).toBeVisible()
  await expect(page.getByText(/^Not in Latentry's list/)).toBeVisible()

  const download = page.getByRole('button', { name: 'Download as LoRA · 0.15 GB' })
  await expect(download).toBeDisabled()
  await page.getByLabel('I have read the license and accept it').nth(0).check()
  await download.click()
  await expect
    .poll(() => calls.at(-1))
    .toEqual({ method: 'POST', path: '/api/engine/models/download', body: { url, revision: commit, folder: 'lora' } })
  await expect(field).toHaveValue('')
})

test('without a running engine, Models says why Download stays off', async ({ page }) => {
  await fakeEngine(page)
  let installed = true
  // Registered last, so it answers before the fake above.
  await page.route(/\/api\/engine$/, (route) => {
    const stopped = status(false)
    if (!installed) stopped.installed = null as never
    return route.fulfill({ json: stopped })
  })
  const download = page.getByRole('button', { name: 'Download · 2.0 GB' })

  await page.goto('/setup')
  await expect(page.getByText('Start the engine to download and load models.')).toBeVisible()
  await page.getByLabel('I have read the license and accept it').check()
  await expect(download).toBeDisabled()

  // Before the engine is installed, the page said nothing about it.
  installed = false
  await page.reload()
  await expect(page.getByText('Models are downloaded and loaded by the engine: install it above, then start it.')).toBeVisible()
  await page.getByLabel('I have read the license and accept it').check()
  await expect(download).toBeDisabled()
})
