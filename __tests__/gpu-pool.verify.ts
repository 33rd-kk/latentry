// Any free GPU: three mock engines made a pool, as Latentry's own engines are
// (two with the same model, one with another). A run asked for with any_gpu
// goes to a free engine with the same model, at once or when one frees up,
// and the page goes on following it through the engine it asked.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { check, done, eq } from './assert'
import { startMockDiffusers, UNTIL_CANCELLED } from './fixtures/mock-diffusers'
import { POST as generateRoute } from '../app/api/gen/[backend]/generate/route'
import { POST as cancelRoute } from '../app/api/gen/[backend]/cancel/route'
import { GET as streamRoute } from '../app/api/gen/[backend]/job/stream/route'
import { GET as backendsRoute } from '../app/api/gen/backends/route'
import { getCurrentJob } from '../lib/diffusion/job-store'
import { getQueued, queueLength } from '../lib/diffusion/run-queue'
import { poolMembers, setTestPools } from '../lib/diffusion/gpu-pool'
import { readSseFrames } from '../lib/diffusion/sse'

const ORIGIN = 'http://127.0.0.1:3000'
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) }) as never

async function until(condition: () => boolean, label: string, ms = 10_000): Promise<void> {
  const end = Date.now() + ms
  while (!condition()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

const post = (backend: string, route: string, body: unknown) =>
  new Request(`${ORIGIN}/api/gen/${backend}/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

async function generate(backend: string, body: Record<string, unknown>) {
  const response = await generateRoute(post(backend, 'generate', body), params({ backend }))
  const json = (await response.json()) as { job?: { id: string; backend: string }; queued?: { id: string; position: number }; error?: string }
  return { status: response.status, job: json.job, queued: json.queued, error: json.error }
}

const cancel = async (backend: string, job: string) => (await cancelRoute(post(backend, 'cancel', { job }), params({ backend }))).status

/** The stream of `id`, opened on `backend` as the page that asked there would, until it ends. */
function watch(backend: string, id: string) {
  const events: { event: string; data: Record<string, unknown> }[] = []
  const finished = (async () => {
    const response = await streamRoute(new NextRequest(`${ORIGIN}/api/gen/${backend}/job/stream?id=${id}`), params({ backend }))
    for await (const frame of readSseFrames(response.body!)) {
      events.push({ event: frame.event, data: JSON.parse(frame.data) })
      if (frame.event === 'end') break
    }
  })()
  return { events, finished }
}

async function main(): Promise<void> {
  const scratch = mkdtempSync(path.join(tmpdir(), 'latentry-pool-'))
  const gpu0 = await startMockDiffusers({ model: 'same.safetensors' })
  const gpu1 = await startMockDiffusers({ model: 'same.safetensors' })
  const gpu2 = await startMockDiffusers({ model: 'other.safetensors' })
  writeFileSync(
    path.join(scratch, 'settings.json'),
    JSON.stringify({
      version: 1,
      backends: [
        { id: 'gpu0', kind: 'diffusers', url: gpu0.url, profile: 'generic' },
        { id: 'gpu1', kind: 'diffusers', url: gpu1.url, profile: 'generic' },
        { id: 'gpu2', kind: 'diffusers', url: gpu2.url, profile: 'generic' },
        { id: 'alone', kind: 'diffusers', url: gpu1.url, profile: 'generic' },
      ],
      gallery: { saveDir: null, dirs: [] },
      engine: { autoStart: false },
    })
  )
  Object.assign(process.env, {
    LATENTRY_SETTINGS_FILE: path.join(scratch, 'settings.json'),
    LATENTRY_RUNTIME_DIR: path.join(scratch, 'runtime'),
    LATENTRY_ENGINE: 'off',
  })
  for (const name of ['GEN_BACKENDS', 'DIFFUSION_SERVER_URL', 'GALLERY_SAVE_DIR', 'GALLERY_DIRS', 'GALLERY_AUTO_TAG']) delete process.env[name]
  setTestPools({ gpu0: 'engine', gpu1: 'engine', gpu2: 'engine' })

  try {
    // ── Who is in the pool ──
    eq(poolMembers('gpu0'), ['gpu1', 'gpu2'], 'the other engines of the pool, in their order')
    eq(poolMembers('alone'), [], 'a backend in no pool has none')
    const listed = (await (await backendsRoute()).json()) as { backends: { id: string; pool?: string; model: string | null }[] }
    eq(
      listed.backends.map(({ id, pool, model }) => [id, pool ?? null, model]),
      [
        ['gpu0', 'engine', 'same.safetensors'],
        ['gpu1', 'engine', 'same.safetensors'],
        ['gpu2', 'engine', 'other.safetensors'],
        ['alone', null, 'same.safetensors'],
      ],
      'the backends list says each engine\'s pool and model, for the page to offer Any free GPU'
    )

    // ── Without any_gpu, a run waits for the engine asked, as before ──
    const long = await generate('gpu0', { prompt: `long ${UNTIL_CANCELLED}` })
    eq([long.status, long.job?.backend], [200, 'gpu0'], 'a run starts on the engine asked')
    const plain = await generate('gpu0', { prompt: 'plain wait' })
    eq(plain.status, 202, 'without any_gpu the next one waits for it, though another is free')
    eq(gpu1.generates.length, 0, 'and nothing went to the other engine')
    eq(await cancel('gpu0', plain.queued!.id), 200, 'taken out of the queue again')

    // ── With any_gpu, a free engine with the same model draws it at once ──
    const elsewhere = await generate('gpu0', { prompt: 'drawn elsewhere', any_gpu: true })
    eq([elsewhere.status, elsewhere.job?.backend], [200, 'gpu1'], 'it starts on a free engine with the same model, and says which')
    const followed = watch('gpu0', elsewhere.job!.id)
    await followed.finished
    eq(followed.events[0]?.event, 'snapshot', 'the page follows it through the engine it asked')
    eq(followed.events[0]?.data.backend, 'gpu1', 'and is told which engine draws it')
    eq(followed.events.at(-1), { event: 'end', data: { status: 'done', error: null, saveError: null } }, 'to its end')
    eq(gpu2.generates.length, 0, 'an engine with another model is never used')

    // ── Waiting, then drawn by whichever engine frees up first ──
    const busy1 = await generate('gpu0', { prompt: `busy one ${UNTIL_CANCELLED}`, any_gpu: true })
    eq(busy1.job?.backend, 'gpu1', 'a second long run takes the other engine')
    const waits = await generate('gpu0', { prompt: 'waits for any', any_gpu: true })
    eq(waits.status, 202, 'with both engines busy, the run waits')
    const waitStream = watch('gpu0', waits.queued!.id)
    await until(() => waitStream.events.length > 0, 'the waiting run\'s stream')
    eq(waitStream.events[0], { event: 'queued', data: { position: 1, waiting: false } }, 'its place, on the engine asked')

    eq(await cancel('gpu0', busy1.job!.id), 200, 'Cancel through the engine asked stops the run on the other engine')
    await until(() => getCurrentJob('gpu1')?.id === waits.queued!.id, 'the freed engine to take the waiting run')
    eq([getQueued('gpu0', waits.queued!.id), queueLength('gpu0')], [null, 0], 'it left the queue of the engine asked')
    await waitStream.finished
    const started = waitStream.events.find(({ event }) => event === 'snapshot')
    eq(started?.data.backend, 'gpu1', 'the page watching it sees it start on the engine that freed up')
    eq(waitStream.events.at(-1)?.data.status, 'done', 'and end')
    check(gpu1.generates.some((asked) => asked.prompt === 'waits for any'), 'the freed engine drew it')

    // ── A run without any_gpu is never taken by another engine ──
    const stays = await generate('gpu0', { prompt: 'stays put' })
    eq(stays.status, 202, 'it waits behind the long run')
    await new Promise((resolve) => setTimeout(resolve, 300))
    eq(getQueued('gpu0', stays.queued!.id)?.state, 'queued', 'though another engine is free')
    eq(await cancel('gpu0', long.job!.id), 200, 'the long run is stopped')
    await until(() => getCurrentJob('gpu0')?.id === stays.queued!.id, 'the engine asked to draw it')
    await until(() => getCurrentJob('gpu0')?.status !== 'running', 'it to end')
    check(gpu0.generates.some((asked) => asked.prompt === 'stays put'), 'the engine asked drew it')
    eq(gpu2.generates.length, 0, 'and still nothing on the engine with another model')
  } finally {
    setTestPools(undefined)
    await gpu0.close()
    await gpu1.close()
    await gpu2.close()
    rmSync(scratch, { recursive: true, force: true })
  }
}

main()
  .then(() => done('gpu-pool'))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
