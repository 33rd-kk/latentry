// The run queue through its routes, against a mock A1111 web UI: a run asked
// for while another runs waits its turn and starts under the id it was given;
// a waiting run can be cancelled or made secret by that id only; other pages
// learn how many wait and nothing else; the queue is bounded; and a backend
// busy with someone else's run is waited for rather than refused.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { check, done, eq } from './assert'
import { startMockA1111 } from './fixtures/mock-a1111'
import { NO_MODEL, startMockDiffusers } from './fixtures/mock-diffusers'
import { POST as generateRoute } from '../app/api/gen/[backend]/generate/route'
import { POST as cancelRoute } from '../app/api/gen/[backend]/cancel/route'
import { GET as jobRoute } from '../app/api/gen/[backend]/job/route'
import { POST as secretRoute } from '../app/api/gen/[backend]/job/secret/route'
import { GET as streamRoute } from '../app/api/gen/[backend]/job/stream/route'
import { getCurrentJob, getJob } from '../lib/diffusion/job-store'
import { getQueued, queueLength, RETRY_MS } from '../lib/diffusion/run-queue'
import { readSseFrames } from '../lib/diffusion/sse'
import { QUEUE_MAX_RUNS } from '../lib/limits'

const ORIGIN = 'http://127.0.0.1:3000'
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) }) as never

async function until(condition: () => boolean, label: string, ms = 10_000): Promise<void> {
  const end = Date.now() + ms
  while (!condition()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

const post = (route: string, body: unknown) =>
  new Request(`${ORIGIN}/api/gen/mock/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

async function generate(body: Record<string, unknown>): Promise<{ status: number; job?: string; queued?: { id: string; position: number }; error?: string }> {
  const response = await generateRoute(post('generate', body), params({ backend: 'mock' }))
  const json = (await response.json()) as { job?: { id: string }; queued?: { id: string; position: number }; error?: string }
  return { status: response.status, job: json.job?.id, queued: json.queued, error: json.error }
}

const cancel = async (job: string | undefined) => (await cancelRoute(post('cancel', { job }), params({ backend: 'mock' }))).status
const jobNow = async () => (await (await jobRoute(new Request(`${ORIGIN}/api/gen/mock/job`), params({ backend: 'mock' }))).json()) as { job: { id: string } | null; queued: number }

/** Opens the stream on `id` and collects its events until `stop` says enough. */
function watch(id: string) {
  const events: { event: string; data: Record<string, unknown> }[] = []
  const controller = new AbortController()
  const finished = (async () => {
    const response = await streamRoute(new NextRequest(`${ORIGIN}/api/gen/mock/job/stream?id=${id}`, { signal: controller.signal }), params({ backend: 'mock' }))
    try {
      for await (const frame of readSseFrames(response.body!)) {
        events.push({ event: frame.event, data: JSON.parse(frame.data) })
        if (frame.event === 'end') break
      }
    } catch {
      // Aborted.
    }
  })()
  return { events, finished, stop: () => controller.abort() }
}

async function main(): Promise<void> {
  const scratch = mkdtempSync(path.join(tmpdir(), 'latentry-queue-'))
  const mock = await startMockA1111()
  const engine = await startMockDiffusers()
  writeFileSync(
    path.join(scratch, 'settings.json'),
    JSON.stringify({
      version: 1,
      backends: [
        { id: 'mock', kind: 'a1111', url: mock.url, profile: 'generic' },
        { id: 'engine', kind: 'diffusers', url: engine.url, profile: 'generic' },
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

  try {
    // ── Runs wait their turn ──
    mock.hold()
    const first = await generate({ prompt: 'first run' })
    eq(first.status, 200, 'the first run starts at once')
    await until(() => mock.received.length === 1, 'the backend to be asked')

    const second = await generate({ prompt: 'second run' })
    const third = await generate({ prompt: 'third run' })
    eq([second.status, third.status], [202, 202], 'two more wait in the queue')
    eq([second.queued?.position, third.queued?.position], [1, 2], 'in the order they were asked for')

    const now = await jobNow()
    eq([now.job?.id, now.queued], [first.job, 2], '/job names the running run and counts the waiting ones')
    check(!JSON.stringify(now).includes(second.queued!.id) && !JSON.stringify(now).includes('second run'), 'without their ids or prompts')

    const thirdStream = watch(third.queued!.id)
    await until(() => thirdStream.events.length > 0, 'the third run\'s stream')
    eq(thirdStream.events[0], { event: 'queued', data: { position: 2, waiting: false } }, 'a waiting run\'s stream says its place')

    // ── Cancelling a waiting run ──
    const secondRun = getQueued('mock', second.queued!.id)!
    eq(await cancel(second.queued!.id), 200, 'a waiting run is cancelled by its id')
    eq([getQueued('mock', second.queued!.id), secondRun.state, secondRun.input], [null, 'cancelled', null], 'it leaves the queue, its prompt and pictures with it')
    await until(() => thirdStream.events.length > 1, 'the third run to move up')
    eq(thirdStream.events[1], { event: 'queued', data: { position: 1, waiting: false } }, 'and the run behind it moves up')
    eq(await cancel('not-a-run'), 409, 'an id nobody was given cancels nothing')
    eq(queueLength('mock'), 1, 'so the third run still waits')

    // ── The queue is bounded ──
    const extra: string[] = []
    for (let index = 1; index < QUEUE_MAX_RUNS; index += 1) extra.push((await generate({ prompt: `extra ${index}` })).queued!.id)
    const over = await generate({ prompt: 'one too many' })
    eq(over.status, 409, `past ${QUEUE_MAX_RUNS} waiting runs a new one is refused`)
    check(over.error?.includes('system.queueFull') ?? false, 'saying the queue is full')
    for (const id of extra) await cancel(id)
    eq(queueLength('mock'), 1, 'the extras are cancelled again')

    // ── Made secret while it waits ──
    const secret = await generate({ prompt: 'secret later' })
    eq((await secretRoute(post('job/secret', { job: secret.queued!.id }), params({ backend: 'mock' }))).status, 200, 'a waiting run can be made secret by its id')
    eq(getQueued('mock', secret.queued!.id)?.input?.secret, true, 'and will start as a secret run')

    // ── The next run starts under the id it waited with ──
    mock.release()
    await until(() => getCurrentJob('mock')?.id === third.queued!.id, 'the third run to start')
    await thirdStream.finished
    const thirdEvents = thirdStream.events.map(({ event }) => event)
    check(thirdEvents.includes('snapshot') && thirdEvents.at(-1) === 'end', `its stream goes on from waiting to the run, to its end (${thirdEvents.join(', ')})`)
    eq(thirdStream.events.at(-1)?.data.status, 'done', 'which is done')
    eq(mock.received[1]?.prompt, 'third run', 'the backend was asked for the third run, not the cancelled second')

    await until(() => getCurrentJob('mock')?.id === secret.queued!.id && getCurrentJob('mock')?.status === 'done', 'the secret run to run')
    eq(getJob('mock', secret.queued!.id)?.secret, true, 'the run made secret while waiting ran as a secret run')
    eq((await jobNow()).job, null, 'and is not offered to other pages')
    eq(queueLength('mock'), 0, 'the queue is empty')

    // ── A backend busy with someone else's run is waited for ──
    mock.otherClient(true)
    const patient = await generate({ prompt: 'after the other client' })
    eq(patient.status, 202, 'a run on a backend busy with another client waits instead of being refused')
    const patientStream = watch(patient.queued!.id)
    await until(() => patientStream.events.some(({ data }) => data.waiting === true), 'the run to say it waits for the backend', RETRY_MS * 3)
    check(getCurrentJob('mock')?.id !== patient.queued!.id, 'and does not start while the other client runs')
    mock.otherClient(false)
    await until(() => getCurrentJob('mock')?.id === patient.queued!.id, 'the run to start once the backend is free', RETRY_MS * 3)
    await patientStream.finished
    eq(patientStream.events.at(-1)?.data.status, 'done', 'and it runs to the end')
    eq(mock.received.length, 4, 'four runs reached the backend: first, third, secret, and this one')

    // ── A 409 that is not "busy" is not waited for ──
    const noModel = await generateRoute(
      new Request(`${ORIGIN}/api/gen/engine/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: `nothing loaded ${NO_MODEL}` }) }),
      params({ backend: 'engine' })
    )
    eq(noModel.status, 409, 'a backend that refuses without being busy (no model loaded) is not queued behind')
    eq(((await noModel.json()) as { error?: string }).error, 'No model is loaded', 'and the page is told why')
    eq(queueLength('engine'), 0, 'nothing waits on it')
  } finally {
    await mock.close()
    await engine.close()
    rmSync(scratch, { recursive: true, force: true })
  }
}

main()
  .then(() => done('queue'))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
