/**
 * The generate → save → gallery path through the API routes themselves, with
 * a mock A1111 web UI (fixtures/mock-a1111.ts) standing in for the backend:
 * a run is started, watched on its event stream, saved into the gallery's
 * save folder, listed and served. A run of several pictures goes to a mock
 * diffusers-compatible server (fixtures/mock-diffusers.ts). Settings and
 * folders are a temp folder's.
 *
 * Run with: npm test -- routes
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { check, done, eq } from './assert'
import { startMockA1111, MOCK_SEED } from './fixtures/mock-a1111'
import { startMockDiffusers } from './fixtures/mock-diffusers'
import { GET as backendsRoute } from '../app/api/gen/backends/route'
import { POST as generateRoute } from '../app/api/gen/[backend]/generate/route'
import { GET as jobRoute } from '../app/api/gen/[backend]/job/route'
import { GET as streamRoute } from '../app/api/gen/[backend]/job/stream/route'
import { GET as galleryRoute } from '../app/api/gallery/route'
import { GET as pictureRoute } from '../app/api/gallery/[dir]/[name]/route'
import { toGenerateRequest } from '../lib/api'
import { getJob } from '../lib/diffusion/job-store'
import { IMAGE_COUNT_MAX } from '../lib/limits'
import { readSseFrames } from '../lib/diffusion/sse'
import { PARAMETERS_KEY, readPngText } from '../lib/image-meta'

const ORIGIN = 'http://127.0.0.1:3000'
const PROMPT = 'a lighthouse at dusk, mock run'

const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) }) as never

async function until(condition: () => boolean, label: string, ms = 10_000): Promise<void> {
  const end = Date.now() + ms
  while (!condition()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

async function main(): Promise<void> {
  const scratch = mkdtempSync(path.join(tmpdir(), 'latentry-routes-'))
  const saveDir = path.join(scratch, 'out')
  const mock = await startMockA1111()
  const many = await startMockDiffusers()
  writeFileSync(
    path.join(scratch, 'settings.json'),
    JSON.stringify({
      version: 1,
      backends: [
        { id: 'mock', kind: 'a1111', url: mock.url, profile: 'generic' },
        { id: 'many', kind: 'diffusers', url: many.url, profile: 'generic' },
      ],
      gallery: { saveDir, dirs: [] },
      engine: { autoStart: false },
    })
  )
  Object.assign(process.env, {
    LATENTRY_SETTINGS_FILE: path.join(scratch, 'settings.json'),
    LATENTRY_RUNTIME_DIR: path.join(scratch, 'runtime'),
    LATENTRY_ENGINE: 'off',
  })
  // Whatever this shell has set must not add a backend or a folder.
  for (const name of ['GEN_BACKENDS', 'DIFFUSION_SERVER_URL', 'GALLERY_SAVE_DIR', 'GALLERY_DIRS', 'GALLERY_AUTO_TAG']) delete process.env[name]

  try {
    // ── Backends ──
    const backends = (await (await backendsRoute()).json()) as { backends: { id: string; alive: boolean; kind: string; model: string | null }[] }
    eq(
      backends.backends.map(({ id, kind, alive }) => ({ id, kind, alive })),
      [
        { id: 'mock', kind: 'a1111', alive: true },
        { id: 'many', kind: 'diffusers', alive: true },
      ],
      'the settings file\'s backends are the only ones, and they answer'
    )
    eq(backends.backends[0]?.model, 'mock-model.safetensors', 'with the model the web UI has loaded')
    check(!JSON.stringify(backends).includes(mock.url.replace(/\/$/, '')), 'the backend list carries no URL')

    // ── Start a run, and refuse a second one while it runs ──
    const generate = (body: unknown) =>
      generateRoute(
        new Request(`${ORIGIN}/api/gen/mock/generate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        params({ backend: 'mock' })
      )
    eq((await generate({})).status, 400, 'a run without a prompt is refused')
    eq((await generateRoute(new Request(`${ORIGIN}/api/gen/nope/generate`, { method: 'POST', body: '{}' }), params({ backend: 'nope' }))).status, 404, 'an unknown backend is a 404')

    mock.hold()
    const started = await generate({ prompt: PROMPT, width: 512, height: 768, num_inference_steps: 12 })
    eq(started.status, 200, 'a run starts')
    const jobId = ((await started.json()) as { job?: { id?: string } }).job?.id ?? ''
    check(jobId.length > 0, 'and answers with its job id')
    await until(() => mock.received.length === 1, 'the backend to be asked')
    const sent = mock.received[0]
    eq([sent.prompt, sent.width, sent.height, sent.steps, sent.n_iter], [PROMPT, 512, 768, 12, 1], 'the backend gets the prompt and settings asked for')

    const second = await generate({ prompt: 'another' })
    eq(second.status, 409, 'a second run while one is running is refused')
    eq(((await second.json()) as { job?: { id?: string } }).job?.id, jobId, 'and points at the running one to reattach to')

    const current = (await (await jobRoute(new Request(`${ORIGIN}/api/gen/mock/job`), params({ backend: 'mock' }))).json()) as { job?: { id?: string; status?: string } }
    eq([current.job?.id, current.job?.status], [jobId, 'running'], '/job reports the running run')

    // ── Watch it on the event stream until it ends ──
    const stream = await streamRoute(new NextRequest(`${ORIGIN}/api/gen/mock/job/stream?id=${jobId}`), params({ backend: 'mock' }))
    eq(stream.status, 200, 'the event stream opens')
    eq(stream.headers.get('content-type'), 'text/event-stream', 'as an event stream')
    mock.release()
    const events: { event: string; data: Record<string, unknown> }[] = []
    for await (const frame of readSseFrames(stream.body!)) {
      events.push({ event: frame.event, data: JSON.parse(frame.data) })
      if (frame.event === 'end') break
    }
    eq(events[0]?.event, 'snapshot', 'it starts with a snapshot')
    const end = events.at(-1)
    eq([end?.event, end?.data.status, end?.data.saveError ?? null], ['end', 'done', null], 'and ends done, saved')
    const image = events.find(({ event }) => event === 'image')?.data
    eq(image?.seed, MOCK_SEED, 'the image arrives with the seed the backend reported')
    check(typeof image?.image_base64 === 'string', 'and its pixels')

    // ── Saved into the gallery's save folder ──
    const job = getJob('mock', jobId)
    eq([job?.status, job?.pendingSaves], ['done', 0], 'the job is done with nothing left to save')
    const saved = job?.images[0]?.saved_name ?? ''
    eq(readdirSync(saveDir), [saved], 'one picture is in the save folder, under the name the job reports')
    check(new RegExp(`^\\d{8}-\\d{6}_mock_${MOCK_SEED}_0\\.png$`).test(saved), `named <date>-<time>_<backend>_<seed>_<index>.png (${saved})`)
    const text = readPngText(readFileSync(path.join(saveDir, saved)))
    check(text[PARAMETERS_KEY]?.startsWith(PROMPT) ?? false, 'its A1111 parameters start with the prompt')
    check(text[PARAMETERS_KEY]?.includes(`Seed: ${MOCK_SEED}`) ?? false, 'and name the seed')

    // ── Listed in the gallery ──
    const gallery = (await (await galleryRoute(new NextRequest(`${ORIGIN}/api/gallery`))).json()) as { dirs: { index: number; writable: boolean }[] }
    eq(gallery.dirs.map(({ index, writable }) => ({ index, writable })), [{ index: 0, writable: true }], 'the gallery has the save folder only')
    check(!JSON.stringify(gallery).includes(scratch), 'and does not say where it is')
    const page = (await (await galleryRoute(new NextRequest(`${ORIGIN}/api/gallery?dir=0`))).json()) as { items: { name: string; width: number | null; height: number | null }[] }
    eq(page.items.map(({ name, width, height }) => ({ name, width, height })), [{ name: saved, width: 64, height: 96 }], 'its page lists the new picture, with its size')
    eq((await galleryRoute(new NextRequest(`${ORIGIN}/api/gallery?dir=1`))).status, 404, 'a folder that is not there is a 404')

    // ── Served ──
    const picture = await pictureRoute(new NextRequest(`${ORIGIN}/api/gallery/0/${saved}`), params({ dir: '0', name: saved }))
    eq([picture.status, picture.headers.get('content-type'), picture.headers.get('cache-control')], [200, 'image/png', 'no-store'], 'the picture is served as a PNG the browser does not keep')
    check(Buffer.from(await picture.arrayBuffer()).equals(readFileSync(path.join(saveDir, saved))), 'byte for byte')
    const thumb = await pictureRoute(new NextRequest(`${ORIGIN}/api/gallery/0/${saved}?thumb=1`), params({ dir: '0', name: saved }))
    eq([thumb.status, thumb.headers.get('content-type')], [200, 'image/webp'], 'and its thumbnail as WebP')
    for (const name of ['../settings.json', '..', 'settings.json', 'missing.png']) {
      eq((await pictureRoute(new NextRequest(`${ORIGIN}/api/gallery/0/x`), params({ dir: '0', name }))).status, 404, `"${name}" is a 404`)
    }

    // ── Several pictures in one run ──
    const run = await generateRoute(
      new Request(`${ORIGIN}/api/gen/many/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: PROMPT, image_count: 2 }),
      }),
      params({ backend: 'many' })
    )
    eq(run.status, 200, 'a run of two pictures starts')
    const runId = ((await run.json()) as { job?: { id?: string; total?: number } }).job?.id ?? ''
    eq(many.generates[0]?.image_count, 2, 'the backend is asked for two')
    await until(() => getJob('many', runId)?.status === 'done' && getJob('many', runId)?.pendingSaves === 0, 'the two-picture run to be saved')
    const pair = getJob('many', runId)!
    eq([pair.completed, pair.total, pair.images.map(({ seed }) => seed)], [2, 2, [1000, 1001]], 'both arrive, image i seeded seed + i')
    const names = pair.images.map(({ saved_name }) => saved_name ?? '')
    check(/_many_1000_0\.png$/.test(names[0]) && /_many_1001_1\.png$/.test(names[1]), `each saved under its seed and index (${names.join(', ')})`)
    eq(readdirSync(saveDir).sort(), [saved, ...names].sort(), 'and both are in the save folder')
    eq(toGenerateRequest({ prompt: PROMPT, image_count: 99 })?.image_count, IMAGE_COUNT_MAX, `a larger count is held to ${IMAGE_COUNT_MAX}`)
  } finally {
    await mock.close()
    await many.close()
    rmSync(scratch, { recursive: true, force: true })
  }
}

main()
  .then(() => done('routes'))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
