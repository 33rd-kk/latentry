/**
 * The backend adapters (lib/backends) and the job store they feed
 * (lib/diffusion/job-store.ts), against scripted backends rather than real
 * servers.
 *
 * Run with: npm test -- backends
 */
import sharp from 'sharp'
import { check, done, eq } from './assert'
import {
  A1111Adapter,
  chooseTaggerModel,
  parseTaggerCaption,
  seedsFromInfo,
  toA1111Payload,
  type A1111Transport,
} from '../lib/backends/a1111'
import { toEvent } from '../lib/backends/diffusers'
import { recordFor } from '../lib/gallery/save'
import { a1111Hints, diffusersHints, hintDetail, MAX_HINT_DETAIL } from '../lib/backends/hints'
import { applyEvent, consumeEvents, getCurrentJob, startJob, toSnapshot } from '../lib/diffusion/job-store'
import type { BackendEvent, GenerateRequest } from '../lib/backends/types'

const REQUEST: GenerateRequest = {
  prompt: '1girl',
  negative_prompt: 'lowres',
  width: 832,
  height: 1216,
  seed: 5,
  image_count: 2,
  sampler: 'Default',
  scheduler: 'Karras',
  num_inference_steps: 20,
  guidance_scale: 5,
}

async function collect(events: AsyncIterable<BackendEvent>): Promise<BackendEvent[]> {
  const all: BackendEvent[] = []
  for await (const event of events) all.push(event)
  return all
}

/**
 * A pretend web UI. `progress` is consulted in order on every poll; the
 * generate call resolves after `pollsBeforeDone` polls.
 */
function scriptedWebUi(options: {
  progress: Record<string, unknown>[]
  pollsBeforeDone: number
  result: { status: number; body: unknown }
}) {
  const calls: { method: string; path: string; body?: unknown }[] = []
  let polls = 0
  let finish: ((value: { status: number; body: unknown }) => void) | null = null
  const transport: A1111Transport = {
    async get(path) {
      calls.push({ method: 'GET', path })
      if (path.startsWith('/sdapi/v1/progress')) {
        const state = options.progress[Math.min(polls, options.progress.length - 1)]
        polls += 1
        if (polls > options.pollsBeforeDone && finish) finish(options.result)
        return { status: 200, body: { state } }
      }
      if (path === '/sdapi/v1/samplers') return { status: 200, body: [{ name: 'Euler a' }, { name: 'DPM++ 2M' }] }
      if (path === '/sdapi/v1/schedulers') return { status: 200, body: [{ name: 'karras', label: 'Karras' }] }
      if (path === '/sdapi/v1/options') return { status: 200, body: { sd_model_checkpoint: 'waiNSFW.safetensors' } }
      return { status: 404, body: null }
    },
    post(path, body) {
      calls.push({ method: 'POST', path, body })
      if (path === '/sdapi/v1/interrupt') return Promise.resolve({ status: 200, body: {} })
      return new Promise((resolve) => {
        finish = resolve
      })
    },
    sleep: () => new Promise((resolve) => setTimeout(resolve, 1)),
  }
  /** Answers the blocked generate call now, as the web UI does after an interrupt. */
  const finishNow = () => finish?.(options.result)
  return { transport, calls, finishNow }
}

async function main() {
  // ── diffusers-compatible events ──
  eq(toEvent('start', { index: 0, total: 2, steps: 30, run_id: 'r1' }), { type: 'start', index: 0, total: 2, steps: 30, runId: 'r1' }, 'start')
  eq(toEvent('image', { index: 1, seed: 9, image_base64: '' }), null, 'an image without bytes is dropped')
  eq(
    toEvent('image', { index: 0, seed: 9, image_base64: 'AA==', loras: [{ name: 'sub/style.safetensors', weight: 0.6 }, { name: 'bare' }, { weight: 1 }] }),
    { type: 'image', index: 0, seed: 9, imageBase64: 'AA==', loras: [{ name: 'style', weight: 0.6 }, { name: 'bare', weight: 1 }] },
    'image: the LoRAs the backend applied, named as everywhere else'
  )
  eq(
    toEvent('image', { index: 0, seed: 9, image_base64: 'AA==', loras: [{ name: 'a', weight: 1, hash: 'ABCDEF012345' }, { name: 'b', weight: 1, hash: '../x' }] }),
    { type: 'image', index: 0, seed: 9, imageBase64: 'AA==', loras: [{ name: 'a', weight: 1, hash: 'abcdef012345' }, { name: 'b', weight: 1 }] },
    'image: a hash is kept only when it looks like one'
  )
  eq('loras' in (toEvent('image', { index: 0, seed: 9, image_base64: 'AA==', loras: [] }) ?? {}), false, 'image: no LoRAs said, none recorded')
  eq(toEvent('error', {}), { type: 'error', message: 'The backend reported an error.' }, 'error without a message')
  eq(toEvent('heartbeat', {}), null, 'unknown events are ignored')

  // ── A1111 helpers ──
  eq(seedsFromInfo('{"all_seeds":[5,6]}'), [5, 6], 'seeds from the info string')
  eq(seedsFromInfo('not json'), [], 'garbage info')
  eq(chooseTaggerModel(['clip', 'wd14-vit-v2', 'wd-v1-4-moat']), 'wd14-vit-v2', 'the first WD model')
  eq(chooseTaggerModel(['a', 'b'], 'b'), 'b', 'A1111_TAGGER_MODEL wins')
  eq(chooseTaggerModel([]), null, 'no tagger')
  eq(
    parseTaggerCaption({ general: 0.9, '1girl': 0.99, long_hair: 0.5 }).map((tag) => tag.name),
    ['1girl', 'long_hair'],
    'flat caption: ratings dropped, sorted by score'
  )
  eq(
    parseTaggerCaption({ rating: { general: 0.9 }, general: { smile: 0.6 }, character: { hatsune_miku: 0.8 } }),
    [
      { name: 'hatsune_miku', score: 0.8, category: 4 },
      { name: 'smile', score: 0.6, category: 0 },
    ],
    'grouped caption: characters keep category 4'
  )

  const t2i = await toA1111Payload(REQUEST, 8)
  eq(t2i?.path, '/sdapi/v1/txt2img', 'no source is txt2img')
  eq([t2i?.body.n_iter, t2i?.body.batch_size, 'sampler_name' in (t2i?.body ?? {}), t2i?.body.scheduler], [2, 1, false, 'Karras'], 'one image per iteration; Default is left to the web UI')

  const source = await sharp({ create: { width: 600, height: 900, channels: 3, background: '#888' } }).png().toBuffer()
  const mask = await sharp({ create: { width: 600, height: 900, channels: 4, background: { r: 236, g: 72, b: 153, alpha: 1 } } }).png().toBuffer()
  const inpaint = await toA1111Payload(
    { ...REQUEST, init_image_base64: `data:image/png;base64,${source.toString('base64')}`, strength: 0.7, mask_base64: mask.toString('base64') },
    8
  )
  eq(inpaint?.path, '/sdapi/v1/img2img', 'a source is img2img')
  check(!String((inpaint?.body.init_images as string[])[0]).startsWith('data:'), 'the data: prefix is stripped')
  check((inpaint?.body.height as number) > (inpaint?.body.width as number), 'the output is fitted to the source aspect')
  const maskMeta = await sharp(Buffer.from(inpaint?.body.mask as string, 'base64')).stats()
  check(maskMeta.channels[0].max === 255, 'painted alpha became white')
  eq(await toA1111Payload({ ...REQUEST, init_image_base64: 'bm90IGFuIGltYWdl' }, 8), null, 'an unreadable source')

  // ── A1111 run ──
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).png().toBuffer()
  const ui = scriptedWebUi({
    progress: [
      { job_count: 0, job_timestamp: 'old' }, // before: idle
      { job_count: 2, job_no: 0, job_timestamp: 'new', sampling_step: 5, sampling_steps: 20 },
      { job_count: 2, job_no: 0, job_timestamp: 'new', sampling_step: 12, sampling_steps: 20 },
      { job_count: 2, job_no: 1, job_timestamp: 'new', sampling_step: 3, sampling_steps: 20 },
      { job_count: 0, job_timestamp: 'new' },
    ],
    pollsBeforeDone: 4,
    result: {
      status: 200,
      body: { images: ['grid', png.toString('base64'), png.toString('base64')], info: JSON.stringify({ all_seeds: [5, 6] }) },
    },
  })
  const adapter = new A1111Adapter({ id: 'sdxl', kind: 'a1111', url: 'http://web.ui', profile: 'illustrious' }, ui.transport)
  const started = await adapter.start(REQUEST)
  check(started.ok, 'an idle web UI accepts the run')
  const events = started.ok ? await collect(started.value) : []
  eq(
    events.map((event) => (event.type === 'image' ? `image:${event.index}:${event.seed}` : event.type === 'step' ? `step:${event.index}:${event.step}` : event.type === 'start' ? `start:${event.index}:${event.runId}` : event.type)),
    ['start:0:new', 'step:0:5', 'step:0:12', 'start:1:new', 'step:1:3', 'image:0:5', 'image:1:6', 'done'],
    'progress is synthesised; the grid is dropped; seeds come from info'
  )
  eq((await adapter.cancel(null)).ok && 'idle', 'idle', 'nothing to cancel after the run')
  // Asked after the run: every status call polls progress too, which would
  // otherwise use up the scripted "before" state.
  const status = await adapter.status()
  eq(
    [status.alive, status.busy, status.model, status.samplers[0], status.schedulers, status.capabilities.pose],
    [true, false, 'waiNSFW.safetensors', 'Default', ['Default', 'Karras'], false],
    'status'
  )

  const busy = scriptedWebUi({ progress: [{ job_count: 1, job_timestamp: 'theirs' }], pollsBeforeDone: 0, result: { status: 200, body: {} } })
  const busyAdapter = new A1111Adapter({ id: 'busy', kind: 'a1111', url: 'http://web.ui', profile: 'sdxl' }, busy.transport)
  const refused = await busyAdapter.start(REQUEST)
  check(!refused.ok && refused.status === 409, 'a web UI busy with someone else refuses with 409')
  check(!busy.calls.some((call) => call.method === 'POST'), 'and nothing is posted to it')

  // Cancel only interrupts the run this adapter started.
  const cancelUi = scriptedWebUi({
    progress: [
      { job_count: 0, job_timestamp: 'old' },
      { job_count: 1, job_no: 0, job_timestamp: 'mine', sampling_step: 1, sampling_steps: 20 },
    ],
    pollsBeforeDone: 99,
    result: { status: 200, body: { images: [png.toString('base64')], info: '{"all_seeds":[1]}' } },
  })
  const cancelAdapter = new A1111Adapter({ id: 'cancel', kind: 'a1111', url: 'http://web.ui', profile: 'sdxl' }, cancelUi.transport)
  const run = await cancelAdapter.start({ ...REQUEST, image_count: 1 })
  if (run.ok) {
    const iterator = run.value[Symbol.asyncIterator]()
    await iterator.next() // start: runId "mine"
    eq((await cancelAdapter.cancel('someone-else')).ok, false, 'a different run id is refused')
    check(!cancelUi.calls.some((call) => call.path === '/sdapi/v1/interrupt'), 'and not interrupted')
    const cancelled = await cancelAdapter.cancel('mine')
    check(cancelled.ok && cancelUi.calls.some((call) => call.path === '/sdapi/v1/interrupt'), 'its own run is interrupted')
    // The web UI answers the blocked call with what it had.
    const rest: BackendEvent[] = []
    const finishing = (async () => {
      for (let next = await iterator.next(); !next.done; next = await iterator.next()) rest.push(next.value)
    })()
    await new Promise((resolve) => setTimeout(resolve, 5))
    cancelUi.finishNow()
    await finishing
    eq(rest.map((event) => event.type).slice(-2), ['image', 'cancelled'], 'what was finished is kept, and the run ends cancelled')
  } else {
    check(false, 'the cancel scenario started')
  }

  // ── Job store ──
  const job = startJob({
    backend: 'b1',
    total: 2,
    steps: 20,
    context: { request: REQUEST, profile: 'sdxl', kind: 'a1111', model: null, mode: 'txt2img' },
  })
  applyEvent(job, { type: 'start', index: 0, total: 2, steps: 18, runId: 'r' })
  applyEvent(job, { type: 'step', index: 0, step: 7 })
  eq([job.runId, job.stepsPerImage, job.currentStep], ['r', 18, 7], 'start and step update the record')
  const saved: string[] = []
  await consumeEvents(
    job,
    (async function* () {
      yield { type: 'image', index: 0, seed: 1, imageBase64: 'AA==' } as BackendEvent
      yield { type: 'image', index: 1, seed: 2, imageBase64: 'AA==' } as BackendEvent
      yield { type: 'done' } as BackendEvent
    })(),
    async (_job, image) => {
      saved.push(String(image.seed))
      return `file-${image.seed}.png`
    }
  )
  await new Promise((resolve) => setTimeout(resolve, 5))
  eq([job.status, job.completed, saved, job.images.map((image) => image.saved_name), job.pendingSaves], ['done', 2, ['1', '2'], ['file-1.png', 'file-2.png'], 0], 'images are saved as they arrive')
  eq('loras' in job.images[0], false, 'an image the backend said no LoRAs for has none')
  const loraJob = startJob({ backend: 'lora', total: 1, steps: 1, context: { ...job.context, kind: 'diffusers' } })
  applyEvent(loraJob, { type: 'image', index: 0, seed: 3, imageBase64: 'AA==', loras: [{ name: 'style', weight: 0.6 }] })
  eq(loraJob.images[0].loras, [{ name: 'style', weight: 0.6 }], 'the applied LoRAs stay with the image')
  const created = new Date(0)
  eq(recordFor(loraJob, loraJob.images[0], created, null).loras, [{ name: 'style', weight: 0.6 }], 'and go into its record')
  applyEvent(loraJob, { type: 'image', index: 0, seed: 4, imageBase64: 'AA==', loras: [{ name: 'style', weight: 0.6, hash: 'abcdef012345' }] })
  eq(recordFor(loraJob, loraJob.images[1], created, null).loras, [{ name: 'style', weight: 0.6 }], 'the record never keeps a hash')
  eq('loras' in recordFor(job, job.images[0], created, null), false, 'a record without applied LoRAs has no loras')
  eq(toSnapshot(job).imageCount, 2, 'the snapshot counts images without carrying them')

  const other = startJob({ backend: 'b2', total: 1, steps: 1, context: job.context })
  check(getCurrentJob('b1') === job && getCurrentJob('b2') === other, 'each backend has its own current job')

  const failing = startJob({ backend: 'b3', total: 1, steps: 1, context: job.context })
  await consumeEvents(
    failing,
    (async function* () {
      yield { type: 'image', index: 0, seed: 1, imageBase64: 'AA==' } as BackendEvent
      yield { type: 'done' } as BackendEvent
    })(),
    async () => {
      throw new Error('disk full')
    }
  )
  await new Promise((resolve) => setTimeout(resolve, 5))
  eq([failing.status, failing.saveError], ['done', 'disk full'], 'a failed save does not fail the run')

  const broken = startJob({ backend: 'b4', total: 1, steps: 1, context: job.context })
  await consumeEvents(
    broken,
    (async function* () {
      yield { type: 'start', index: 0, total: 1, steps: 1 } as BackendEvent
      throw new Error('socket closed')
    })()
  )
  eq(broken.status, 'error', 'a stream that breaks ends the job in error')

  // ── Why a feature is off ──
  eq(diffusersHints(null), {}, 'a server that did not answer gets no feature hints')
  eq(
    diffusersHints({ model: 'anima' }),
    { pose: { reason: 'not-reported' } },
    'a server silent about pose is told to report pose_control; img2img and inpaint stay on'
  )
  eq(diffusersHints({ pose_control: true, lora: false }), {}, 'LoRA support is not a hinted feature: the prompt says so where it matters')
  eq(diffusersHints({ pose_control: true }), {}, 'a server with pose and default img2img/inpaint has no hints')
  eq(
    diffusersHints({ pose_control: false, inpaint: false, unavailable: { pose: 'Needs a 28-layer model.' } }),
    { inpaint: { reason: 'declined' }, pose: { reason: 'declined', detail: 'Needs a 28-layer model.' } },
    "an explicit false is declined, with the server's reason when it gives one"
  )
  eq(
    diffusersHints({ unavailable: { pose: 'Adapter weights missing.' } }),
    { pose: { reason: 'declined', detail: 'Adapter weights missing.' } },
    'a reason without the flag still counts as the server declining'
  )
  eq(diffusersHints({ pose_control: true, unavailable: { pose: 'stale' } }), {}, 'a reason for a feature that is on is ignored')
  eq(diffusersHints({ unavailable: 'nope' }), { pose: { reason: 'not-reported' } }, 'a malformed unavailable field is ignored')
  eq(hintDetail('  two\nlines\t here  '), 'two lines here', 'a reason is folded onto one line')
  eq(hintDetail(''), undefined, 'an empty reason is none')
  eq(hintDetail(42), undefined, 'a reason that is not text is none')
  const long = hintDetail('x'.repeat(500))
  check(long?.length === MAX_HINT_DETAIL && long.endsWith('…'), 'a long reason is cut to the limit')
  eq(a1111Hints(true), { pose: { reason: 'kind' } }, 'A1111 cannot take a pose, by kind')
  eq(a1111Hints(false), {}, 'an A1111 that is down gets no feature hints')

  done('backends')
}

void main()
