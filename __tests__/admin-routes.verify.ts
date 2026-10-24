/**
 * The API routes routes.verify.ts does not reach: settings, tagging, the
 * gallery's tags / autotag / open, presets, and the engine's routes. Each is
 * asked from this machine and from a phone on the LAN, since most of them are
 * only for this machine. Settings, folders and the runtime folder are a temp
 * folder's; the mock A1111 web UI (fixtures/mock-a1111.ts) tags, and a small
 * stand-in answers as a running engine.
 *
 * Nothing here really installs, downloads, starts an engine or opens a file
 * manager: those routes are only asked what they refuse.
 *
 * Run with: npm test -- admin-routes
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { check, done, eq } from './assert'
import { startMockA1111, MOCK_TAGS } from './fixtures/mock-a1111'
import packageJson from '../package.json'

const packageVersion = packageJson.version
import { GET as settingsGet, PUT as settingsPut } from '../app/api/settings/route'
import { POST as tagRoute } from '../app/api/gen/tag/route'
import { GET as presetsRoute } from '../app/api/gen/[backend]/presets/route'
import { POST as tagsRoute } from '../app/api/gallery/[dir]/[name]/tags/route'
import { POST as openRoute } from '../app/api/gallery/[dir]/[name]/open/route'
import { POST as autotagRoute } from '../app/api/gallery/[dir]/autotag/route'
import { GET as engineRoute } from '../app/api/engine/route'
import { POST as installRoute } from '../app/api/engine/install/route'
import { POST as startRoute } from '../app/api/engine/start/route'
import { POST as stopRoute } from '../app/api/engine/stop/route'
import { GET as lorasRoute } from '../app/api/engine/loras/route'
import { GET as modelsRoute } from '../app/api/engine/models/route'
import { POST as loadRoute } from '../app/api/engine/models/load/route'
import { POST as downloadRoute } from '../app/api/engine/models/download/route'
import { catalogEntry } from '../lib/engine/catalog'
import { engines, type EngineProcess } from '../lib/engine/supervisor'
import { sourceEngineVersion, versionIn } from '../lib/engine/version'
import { metaFromText, readPngText } from '../lib/image-meta'
import { getSettings } from '../lib/settings/store'

const ORIGIN = 'http://127.0.0.1:3000'
const LOCAL = { host: 'localhost:3000', 'x-forwarded-for': '127.0.0.1' }
const PHONE = { host: '192.168.1.20:3000', 'x-forwarded-for': '192.168.1.30' }
const TOKEN = 'stand-in-engine-token'
const SDXL = catalogEntry('sdxl-base-1.0')!

const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) }) as never

function request(pathname: string, init: { method?: string; from?: Record<string, string>; body?: unknown } = {}): Request {
  const { method = 'POST', from = LOCAL, body } = init
  return new Request(`${ORIGIN}${pathname}`, {
    method,
    headers: { ...from, 'content-type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const read = async (response: Response) => [response.status, await response.json()] as [number, Record<string, unknown>]

/** A stand-in for a running engine's own API (engine/latentry_engine), as engineFetch calls it. */
async function startStandInEngine() {
  const calls: { route: string; body: unknown }[] = []
  const server = createServer((req, res) => {
    let text = ''
    req.on('data', (chunk) => (text += chunk))
    req.on('end', () => {
      const reply = (status: number, body: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(body))
      }
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return reply(401, { detail: 'No token' })
      const route = `${req.method} ${req.url}`
      const body = text ? JSON.parse(text) : null
      calls.push({ route, body })
      switch (route) {
        case 'GET /api/models':
          return reply(200, {
            models: [
              { id: 'mine.safetensors', name: 'mine', family: 'sdxl', size_bytes: 10 },
              { id: 'unknown.safetensors', name: 'unknown', family: null, size_bytes: 5 },
            ],
            current: 'mine.safetensors',
            loading: null,
            load_error: 'out of memory',
          })
        case 'GET /api/models/downloads':
          return reply(200, { downloads: [{ repo_id: SDXL.repo, filename: SDXL.filename, state: 'downloading', done_bytes: 1, total_bytes: 4, error: null }] })
        case 'GET /api/loras':
          return reply(200, { loras: [{ name: 'style.safetensors', family: 'sdxl', license: 'MIT' }, { name: 'bare.safetensors' }, { name: '' }, { family: 'sdxl' }] })
        case 'POST /api/models/load':
          return body?.id === 'broken.safetensors' ? reply(422, { detail: 'Not a model' }) : reply(202, { status: 'loading' })
        case 'POST /api/models/download':
          return reply(202, { status: 'queued' })
        default:
          return reply(404, { detail: 'Not Found' })
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    port: (server.address() as AddressInfo).port,
    calls,
    close: () => {
      server.closeAllConnections()
      return new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

async function main(): Promise<void> {
  const scratch = mkdtempSync(path.join(tmpdir(), 'latentry-admin-routes-'))
  const saveDir = path.join(scratch, 'out')
  const readOnlyDir = path.join(scratch, 'shelf')
  const modelsDir = path.join(scratch, 'models')
  for (const dir of [saveDir, readOnlyDir, modelsDir]) mkdirSync(dir)
  const mock = await startMockA1111({ tagger: true })
  const engine = await startStandInEngine()
  const settingsFile = path.join(scratch, 'settings.json')
  writeFileSync(
    settingsFile,
    JSON.stringify({
      version: 1,
      backends: [{ id: 'mock', kind: 'a1111', url: mock.url, profile: 'generic' }],
      gallery: { saveDir, dirs: [readOnlyDir] },
      engine: { autoStart: false, modelsDir },
    })
  )
  Object.assign(process.env, {
    LATENTRY_SETTINGS_FILE: settingsFile,
    LATENTRY_RUNTIME_DIR: path.join(scratch, 'runtime'),
    LATENTRY_ENGINE: 'off',
  })
  // Whatever this shell has set must not add a backend, a folder or a tagger, or change who may edit.
  for (const name of ['GEN_BACKENDS', 'DIFFUSION_SERVER_URL', 'GALLERY_SAVE_DIR', 'GALLERY_DIRS', 'GALLERY_AUTO_TAG', 'TAGGER_BACKEND', 'WD14_MODEL_DIR', 'SETTINGS_EDIT']) {
    delete process.env[name]
  }

  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#335577' } }).png().toBuffer()
  writeFileSync(path.join(saveDir, 'a.png'), png)
  writeFileSync(path.join(saveDir, 'b.png'), png)
  writeFileSync(path.join(saveDir, 'c.jpg'), await sharp(png).jpeg().toBuffer())
  writeFileSync(path.join(readOnlyDir, 'kept.png'), png)
  const tagsIn = (dir: string, name: string) => metaFromText(readPngText(readFileSync(path.join(dir, name))))?.tags ?? null

  try {
    // ── Tagging and presets ──
    eq((await tagRoute(request('/api/gen/tag', { body: {} }))).status, 400, 'tagging without a picture is refused')
    const [tagStatus, tagged] = await read(await tagRoute(request('/api/gen/tag', { body: { image_base64: png.toString('base64') } })))
    eq([tagStatus, tagged.tags], [200, MOCK_TAGS], "a picture is tagged by the backend's tagger, best first, ratings left out")

    const presets = await presetsRoute(new Request(`${ORIGIN}/api/gen/mock/presets`), params({ backend: 'mock' }))
    eq([presets.status, await presets.json()], [200, { default: null, presets: [] }], 'an A1111 backend has no presets')
    eq(presets.headers.get('cache-control'), 'private, max-age=60', 'and the answer is kept a minute, by this browser only')
    eq((await presetsRoute(new Request(`${ORIGIN}/api/gen/nope/presets`), params({ backend: 'nope' }))).status, 404, 'an unknown backend is a 404')

    // ── Writing tags into a picture ──
    const writeTags = (dir: string, name: string, body: unknown) => tagsRoute(request(`/api/gallery/${dir}/${name}/tags`, { body }), params({ dir, name }))
    const tags = [{ name: 'harbor', score: 1.7, category: 0 }, { name: 'x'.repeat(300), score: -1 }]
    eq((await writeTags('9', 'a.png', { tags })).status, 404, 'a folder that is not there is a 404')
    eq((await writeTags('x', 'a.png', { tags })).status, 404, 'so is one that is not a number')
    eq((await writeTags('1', 'kept.png', { tags })).status, 403, 'a read-only folder is not written')
    eq(tagsIn(readOnlyDir, 'kept.png'), null, 'and its picture is as it was')
    eq((await writeTags('0', 'a.png', { tags: 'harbor' })).status, 400, 'tags must be a list')
    eq((await writeTags('0', 'a.png', { tags: Array.from({ length: 501 }, () => tags[0]) })).status, 400, 'of at most 500')
    eq((await writeTags('0', 'a.png', { tags: [{ name: 'harbor' }] })).status, 400, 'each with a name and a score')
    eq((await writeTags('0', 'missing.png', { tags })).status, 404, 'a picture that is not there is a 404')
    eq((await writeTags('0', 'c.jpg', { tags })).status, 404, 'and a JPEG cannot hold tags')
    eq((await writeTags('0', 'a.png', { tags })).status, 200, 'tags are written into a PNG of the save folder')
    eq(
      tagsIn(saveDir, 'a.png'),
      [{ name: 'harbor', score: 1, category: 0 }, { name: 'x'.repeat(200), score: 0, category: 0 }],
      'scores kept between 0 and 1, names cut at 200 characters, the category 0 when not given'
    )

    // ── Auto-tagging a batch ──
    const autotag = (dir: string, body: unknown) => autotagRoute(request(`/api/gallery/${dir}/autotag`, { body }), params({ dir }))
    eq((await autotag('9', { names: ['a.png'] })).status, 404, 'auto-tagging a folder that is not there is a 404')
    eq((await autotag('1', { names: ['kept.png'] })).status, 403, 'a read-only folder is not auto-tagged')
    eq((await autotag('0', { names: ['../settings.json', '.hidden.png', 'notes.txt'] })).status, 400, 'names that are not pictures of the folder are left out, leaving none')
    eq((await autotag('0', { names: Array.from({ length: 1001 }, (_, index) => `${index}.png`) })).status, 400, 'at most 1000 at once')

    const batch = await autotag('0', { names: ['a.png', 'b.png', 'c.jpg', 'missing.png', '../x.png'], skipTagged: true })
    eq([batch.status, batch.headers.get('content-type')], [200, 'application/x-ndjson; charset=utf-8'], 'a batch answers a line per picture as it goes')
    const lines = (await batch.text()).trim().split('\n').map((line) => JSON.parse(line))
    eq(
      lines.slice(0, -1).map(({ name, status, error }) => ({ name, status, error: error ?? null })),
      [
        { name: 'a.png', status: 'skipped', error: null },
        { name: 'b.png', status: 'tagged', error: null },
        { name: 'c.jpg', status: 'failed', error: 'Only PNG files can hold tags' },
        { name: 'missing.png', status: 'failed', error: 'Not found' },
      ],
      'a tagged picture is skipped, a PNG tagged, a JPEG and a missing one fail, and an unsafe name is not even tried'
    )
    eq(lines.at(-1), { done: true, tagged: 1, skipped: 1, failed: 2, cancelled: false }, 'the last line counts them')
    eq(tagsIn(saveDir, 'b.png'), MOCK_TAGS, 'the tagged picture holds its tags')
    eq(tagsIn(saveDir, 'a.png')?.[0]?.name, 'harbor', 'and the skipped one keeps its own')
    const again = await autotag('0', { names: ['a.png'] })
    eq(((await again.text()).trim().split('\n').map((line) => JSON.parse(line))[0] as { status: string }).status, 'tagged', 'without skipTagged, a tagged picture is tagged again')
    eq(tagsIn(saveDir, 'a.png'), MOCK_TAGS, 'and its tags replaced')

    // ── Opening a picture: only refusals, so no file manager opens ──
    const open = (dir: string, name: string, body: unknown, from = LOCAL) => openRoute(request(`/api/gallery/${dir}/${name}/open`, { body, from }), params({ dir, name }))
    eq((await open('0', 'a.png', { action: 'reveal' }, PHONE)).status, 403, 'a phone cannot open a picture on this screen')
    eq((await open('9', 'a.png', { action: 'reveal' })).status, 404, 'a folder that is not there is a 404')
    eq((await open('0', 'a.png', { action: 'delete' })).status, 400, 'only reveal and open are actions')
    eq((await open('0', 'missing.png', { action: 'open' })).status, 404, 'a picture that is not there is a 404, and nothing is started')

    // ── Settings ──
    const [phoneStatus, phoneView] = await read(await settingsGet(request('/api/settings', { method: 'GET', from: PHONE })))
    eq([phoneStatus, phoneView], [200, { editable: false, reason: 'notLocal' }], 'a phone is told it cannot edit the settings, and nothing else')
    const [, view] = await read(await settingsGet(request('/api/settings', { method: 'GET' })))
    eq([view.editable, view.file], [true, settingsFile], 'this machine is shown the settings and their file')
    eq(view.version, packageVersion, 'and the version of Latentry it runs, to match against advisories')
    check(!JSON.stringify(phoneView).includes(packageVersion), 'a phone is not told the version')
    eq((view.gallery as { saveDir: string; dirs: string[] }).dirs, [readOnlyDir], 'with the folders')

    const put = (body: unknown, from = LOCAL) => settingsPut(request('/api/settings', { method: 'PUT', body, from }))
    const before = readFileSync(settingsFile, 'utf8')
    eq((await put({ gallery: { saveDir: scratch } }, PHONE)).status, 403, 'a phone cannot change them')
    process.env.SETTINGS_EDIT = 'off'
    const [offStatus, off] = await read(await put({ gallery: { saveDir: scratch } }))
    eq([offStatus, off.error], [403, 'Settings are read-only (SETTINGS_EDIT=off)'], 'nor can this machine with SETTINGS_EDIT=off')
    eq((await read(await settingsGet(request('/api/settings', { method: 'GET' }))))[1], { editable: false, reason: 'off' }, 'which the page is told')
    delete process.env.SETTINGS_EDIT
    eq((await put('{not json')).status, 400, 'a body that is not JSON is refused')
    const [badStatus, bad] = await read(await put({ gallery: { saveDir: 'relative/out' } }))
    eq([badStatus, bad.errors], [422, { 'gallery.saveDir': 'settings.errorAbsolute' }], 'a value that is not valid is named')
    const [dirStatus, dirs] = await read(
      await put({
        gallery: { saveDir: saveDir, dirs: [path.join(scratch, 'gone')] },
        engine: { modelsDir: path.join(scratch, 'no-models') },
        wd14: { modelDir: modelsDir },
        backends: [{ id: 'comfy', kind: 'comfyui', url: mock.url, profile: 'generic', workflowsDir: path.join(scratch, 'no-workflows') }],
      })
    )
    eq(
      [dirStatus, dirs.errors],
      [
        422,
        {
          'gallery.dirs.0': 'settings.dir.missing',
          'engine.modelsDir': 'settings.dir.missing',
          'backends.0.workflowsDir': 'settings.dir.missing',
          'wd14.modelDir': 'settings.wd14Missing',
        },
      ],
      'folders that are not there, and a WD14 folder without the model, are named'
    )
    eq(readFileSync(settingsFile, 'utf8'), before, 'nothing refused reaches the settings file')

    const newSave = path.join(scratch, 'new', 'out')
    const [savedStatus, saved] = await read(await put({ gallery: { saveDir: newSave, dirs: [] } }))
    eq(savedStatus, 200, 'a valid edit is saved')
    eq((saved.gallery as { saveDir: string }).saveDir, newSave, 'and answered with the new settings')
    eq(JSON.parse(readFileSync(settingsFile, 'utf8')).gallery, { saveDir: newSave, dirs: [] }, 'into the settings file')
    check(readFileSync(settingsFile, 'utf8').includes(mock.url), 'keeping the parts not sent')
    eq((await open('1', 'kept.png', { action: 'open' })).status, 404, 'and it applies at once: the read-only folder is gone')
    eq((await put({ gallery: { saveDir, dirs: [readOnlyDir] } })).status, 200, 'the folders are put back')

    // A settings file from a newer Latentry is not saved over.
    const current = readFileSync(settingsFile, 'utf8')
    const newer = JSON.stringify({ ...JSON.parse(current), version: 2, later: true })
    writeFileSync(settingsFile, newer)
    const [newerStatus, newerBody] = await read(await put({ tagger: null }))
    eq([newerStatus, newerBody.error], [409, 'i18n:settings.newerFile|{"version":2}'], 'a save over a newer settings file is refused, with a message the page translates')
    eq(readFileSync(settingsFile, 'utf8'), newer, 'and the file is left as it was')
    writeFileSync(settingsFile, current)

    // ── The engine, while none runs ──
    const phone = { method: 'GET', from: PHONE }
    eq((await read(await engineRoute(request('/api/engine', phone))))[1], { editable: false, reason: 'notLocal' }, 'a phone is not shown the engine')
    eq((await read(await modelsRoute(request('/api/engine/models', phone))))[1], { editable: false }, 'nor its models')
    eq((await read(await lorasRoute(request('/api/engine/loras', phone))))[1], { editable: false, shared: false }, 'nor its LoRAs, unless shared')
    for (const [name, route] of [
      ['install', installRoute],
      ['start', startRoute],
      ['stop', stopRoute],
      ['models/load', loadRoute],
      ['models/download', downloadRoute],
    ] as const) {
      eq((await route(request(`/api/engine/${name}`, { from: PHONE, body: { id: 'sdxl-base-1.0' } }))).status, 403, `a phone cannot ${name}`)
    }
    process.env.SETTINGS_EDIT = 'off'
    eq((await installRoute(request('/api/engine/install'))).status, 403, 'nor can this machine install with SETTINGS_EDIT=off')
    delete process.env.SETTINGS_EDIT

    const [, status] = await read(await engineRoute(request('/api/engine', { method: 'GET' })))
    eq(
      [status.editable, status.runtimeDir, status.modelsDir, status.customModelsDir, status.installed, status.engines, status.models],
      [true, path.join(scratch, 'runtime'), modelsDir, modelsDir, null, [], null],
      'this machine sees the engine not installed, with its folders and no models'
    )
    const catalog = status.catalog as { id: string; installed: boolean; dir: string | null; download: unknown }[]
    eq(catalog.find((entry) => entry.id === 'wd-vit-tagger-v3')?.dir, path.join(modelsDir, 'wd14', 'wd-vit-tagger-v3'), 'a tagger downloads into the models folder')
    check(catalog.every((entry) => !entry.installed && entry.download === null), 'nothing in the catalog is there or downloading')

    const [startStatus, start] = await read(await startRoute(request('/api/engine/start')))
    eq([startStatus, start.reason], [409, 'notInstalled'], 'the engine cannot start before it is installed')
    eq((await read(await stopRoute(request('/api/engine/stop'))))[1], { status: 'stopped' }, 'stopping with none running is fine')
    eq((await read(await modelsRoute(request('/api/engine/models', { method: 'GET' }))))[1], { editable: true, engines: [], models: [], current: null, loading: null, loadError: null }, 'no models without an engine')
    eq((await read(await lorasRoute(request('/api/engine/loras?probe=1', { method: 'GET' }))))[1], { editable: true, shared: false, engines: [] }, 'the LoRA probe finds no engine')
    eq((await read(await lorasRoute(request('/api/engine/loras', { method: 'GET' }))))[1], { editable: true, shared: false, loras: [] }, 'and no LoRAs')
    eq((await loadRoute(request('/api/engine/models/load', { body: { id: '../x' } }))).status, 400, 'a model id is a name in the models folder, not a path')
    eq((await loadRoute(request('/api/engine/models/load', { body: { id: 'mine.safetensors' } }))).status, 409, 'nothing loads without an engine')
    eq((await downloadRoute(request('/api/engine/models/download', { body: { id: 'any/repo' } }))).status, 404, 'only catalog entries are downloaded')
    eq((await downloadRoute(request('/api/engine/models/download', { body: { id: SDXL.id } }))).status, 409, 'and a checkpoint only by a running engine')

    // ── The engine, with a stand-in running ──
    // The supervisor keeps its engines on globalThis (lib/engine/supervisor.ts);
    // one with no child process is never stopped or restarted, only asked.
    const running: EngineProcess = {
      id: 'engine', gpu: null, port: engine.port, token: TOKEN, state: 'running', pid: null, child: null, restarts: [], log: ['ready'],
      model: 'mine.safetensors', family: 'sdxl', loading: null, loadError: null, version: '0.0.1', stopping: false,
    }
    ;(globalThis as { __latentryEngines?: { engines: Map<string, EngineProcess> } }).__latentryEngines!.engines.set(running.id, running)
    eq(engines().length, 1, 'the stand-in is the only engine')

    const [, live] = await read(await engineRoute(request('/api/engine', { method: 'GET' })))
    eq(live.models, [{ id: 'mine.safetensors', name: 'mine', family: 'sdxl', sizeBytes: 10 }, { id: 'unknown.safetensors', name: 'unknown', family: null, sizeBytes: 5 }], 'the setup page lists what the engine has')
    eq(live.current, 'mine.safetensors', 'and what it has loaded')
    eq(
      (live.catalog as { id: string; download: unknown }[]).find((entry) => entry.id === SDXL.id)?.download,
      { state: 'downloading', doneBytes: 1, totalBytes: 4, error: null },
      "with a catalog entry's download progress"
    )
    eq(
      (live.engines as { id: string; state: string; log: string[] }[]).map(({ id, state, log }) => ({ id, state, log })),
      [{ id: 'engine', state: 'running', log: ['ready'] }],
      'and the engine with its log'
    )
    eq(live.engineVersion, sourceEngineVersion(), "the engine version in Latentry's folder")
    check(typeof live.engineVersion === 'string' && /^\d+\.\d+\.\d+/.test(live.engineVersion), `read from engine/latentry_engine/__init__.py (${live.engineVersion})`)
    eq((live.engines as { version: string | null }[])[0].version, '0.0.1', 'and the version the running engine reports, so Setup can say when they differ')
    eq(versionIn('"""x"""\n\n__version__ = "1.2.3"\n'), '1.2.3', 'the version line is found')
    eq(versionIn('no version here'), null, 'and missing it gives none')
    eq(
      (await read(await modelsRoute(request('/api/engine/models', { method: 'GET' }))))[1],
      {
        editable: true,
        engines: ['engine'],
        models: [{ id: 'mine.safetensors', name: 'mine', family: 'sdxl', profile: 'sdxl' }],
        current: 'mine.safetensors',
        loading: null,
        loadError: 'out of memory',
      },
      'the model picker gets the models of a known family, with the last load error'
    )
    eq(
      (await read(await lorasRoute(request('/api/engine/loras', { method: 'GET' }))))[1],
      {
        editable: true,
        shared: false,
        loras: [
          { name: 'style.safetensors', family: 'sdxl', license: 'MIT' },
          { name: 'bare.safetensors', family: null, license: null },
        ],
      },
      'the LoRA picker gets names only, nameless entries left out'
    )
    eq((await read(await lorasRoute(request('/api/engine/loras?probe=1', { method: 'GET' }))))[1], { editable: true, shared: false, engines: ['engine'] }, 'and the probe names the engine')

    const [failStatus, fail] = await read(await loadRoute(request('/api/engine/models/load', { body: { id: 'broken.safetensors' } })))
    eq([failStatus, fail.error], [422, 'Not a model'], "a load the engine refuses comes back with the engine's reason")
    check(getSettings().engine?.model === undefined, 'and is not remembered')
    const [loadStatus, load] = await read(await loadRoute(request('/api/engine/models/load', { body: { id: 'mine.safetensors' } })))
    eq([loadStatus, load.status], [202, 'loading'], 'a model loads on the engine')
    eq(JSON.parse(readFileSync(settingsFile, 'utf8')).engine.model, 'mine.safetensors', 'and is remembered for the next start')

    eq((await downloadRoute(request('/api/engine/models/download', { body: { id: SDXL.id } }))).status, 202, 'a catalog checkpoint is downloaded by the engine')
    eq(
      engine.calls.find((call) => call.route === 'POST /api/models/download')?.body,
      { repo_id: SDXL.repo, revision: SDXL.revision, filename: SDXL.filename, sha256: SDXL.sha256![SDXL.filename!] },
      'pinned to its revision and checksum'
    )

    eq((await read(await stopRoute(request('/api/engine/stop'))))[1], { status: 'stopped' }, 'stop')
    eq(running.state, 'stopped', 'marks the engine stopped')
    eq((await read(await modelsRoute(request('/api/engine/models', { method: 'GET' }))))[1].engines, [], 'and it is no longer asked')
  } finally {
    await mock.close()
    await engine.close()
    rmSync(scratch, { recursive: true, force: true })
  }
}

main()
  .then(() => done('admin-routes'))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
