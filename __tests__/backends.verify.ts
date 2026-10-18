/**
 * The backend adapters (lib/backends) and the job store they feed
 * (lib/diffusion/job-store.ts), against scripted backends rather than real
 * servers.
 *
 * Run with: npm test -- backends
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import sharp from 'sharp'
import { check, done, eq } from './assert'
import { modeOf, toGenerateRequest } from '../lib/api'
import { hiresSchedule } from '../lib/diffusion/hires'
import { A1111Adapter } from '../lib/backends/a1111'
import { seedsFromInfo, toA1111Payload } from '../lib/backends/a1111-payload'
import { chooseTaggerModel, parseTaggerCaption } from '../lib/backends/a1111-tagger'
import type { A1111Transport } from '../lib/backends/a1111-transport'
import { DiffusersAdapter, toEvent } from '../lib/backends/diffusers'
import { openBackendWarning } from '../lib/backends/exposure'
import { errorMessage, REDIRECT_REFUSED, redactPaths } from '../lib/backends/http'
import { recordFor } from '../lib/gallery/save'
import { a1111Hints, diffusersHints, hintDetail, MAX_HINT_DETAIL, problemOf } from '../lib/backends/hints'
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
      if (path === '/sdapi/v1/options') return { status: 200, body: { sd_model_checkpoint: 'sdxl\\anime\\waiNSFW.safetensors [abc123]' } }
      return { status: 404, body: null }
    },
    post(path, body) {
      calls.push({ method: 'POST', path, body })
      if (path === '/sdapi/v1/interrupt') return Promise.resolve({ status: 200, body: {} })
      // The extras tab answers at once, with the picture it enlarged.
      if (path === '/sdapi/v1/extra-single-image') return Promise.resolve({ status: 200, body: { image: 'UPSCALED', html_info: '' } })
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

  // Paths in a backend's words are hidden: a paired phone may be reading them.
  eq(
    toEvent('error', { message: "[Errno 2] No such file or directory: 'C:\\Users\\me\\models\\x.safetensors'" }),
    { type: 'error', message: "[Errno 2] No such file or directory: '<path>'" },
    'a Windows path in an error event'
  )
  eq(
    [
      redactPaths('cannot open /home/me/models/loras/style.safetensors now'),
      redactPaths('share \\\\nas\\pictures\\a.png gone'),
      redactPaths('D:/ComfyUI/output failed'),
      redactPaths('see http://192.168.1.5:7860/sdapi/v1/txt2img for 1/2 of it'),
      redactPaths('/api only'),
    ],
    ['cannot open <path> now', 'share <path> gone', '<path> failed', 'see http://192.168.1.5:7860/sdapi/v1/txt2img for 1/2 of it', '/api only'],
    'POSIX, network and forward-slash Windows paths go; URLs, fractions and single words stay'
  )
  eq(errorMessage({ detail: 'No model at E:\\sd\\x.ckpt' }, 'x'), 'No model at <path>', 'errorMessage hides them too')
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
  check(!('enable_hr' in (t2i?.body ?? {})) && !('denoising_strength' in (t2i?.body ?? {})), 'no hires fix unless asked')
  const hires = await toA1111Payload({ ...REQUEST, hr_scale: 1.5, hr_steps: 0, hr_denoise: 0.35, hr_upscaler: 'R-ESRGAN 4x+' }, 8)
  eq(
    [hires?.path, hires?.body.enable_hr, hires?.body.hr_scale, hires?.body.hr_upscaler, hires?.body.hr_second_pass_steps, hires?.body.denoising_strength, hires?.body.hr_additional_modules, hires?.body.hr_cfg],
    ['/sdapi/v1/txt2img', true, 1.5, 'R-ESRGAN 4x+', 0, 0.35, ['Use same choices'], 5],
    'hires fix in the web UI\'s fields; 0 steps is its own "as many as the first pass"; Forge needs its modules named, and the first pass\'s CFG'
  )
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

  // Upscale: the extras tab enlarges the 600 x 900 source to 1.5x, img2img redraws it.
  const UPSCALE: GenerateRequest = {
    ...REQUEST,
    image_count: 1,
    init_image_base64: source.toString('base64'),
    upscale: true,
    hr_scale: 1.5,
    hr_steps: 12,
    hr_denoise: 0.35,
    hr_upscaler: 'R-ESRGAN 4x+',
  }
  const upscalePayload = await toA1111Payload(UPSCALE, 8)
  eq(
    [upscalePayload?.path, upscalePayload?.body.width, upscalePayload?.body.height, upscalePayload?.body.denoising_strength, upscalePayload?.body.steps, 'init_images' in (upscalePayload?.body ?? {})],
    ['/sdapi/v1/img2img', 904, 1352, 0.35, hiresSchedule(12, 0.35), false],
    'upscale: img2img at the source size times the scale, with a schedule that runs the hires steps; its picture comes from extras'
  )
  eq(
    upscalePayload?.extras && [upscalePayload.extras.resize_mode, upscalePayload.extras.upscaling_resize_w, upscalePayload.extras.upscaling_resize_h, upscalePayload.extras.upscaler_1],
    [1, 904, 1352, 'R-ESRGAN 4x+'],
    'the extras call enlarges to that exact size with the chosen upscaler'
  )
  eq([hiresSchedule(12, 0.35), hiresSchedule(10, 0.4), hiresSchedule(20, 1)], [35, 25, 20], 'the schedule an img2img pass is asked for to run the steps')

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

  // The step count arrives a moment after the job: until then the web UI
  // still reports the previous run's (seen on Forge Neo and A1111 alike).
  const staleUi = scriptedWebUi({
    progress: [
      { job_count: 0, job_timestamp: 'old', sampling_steps: 20 },
      { job_count: 1, job_no: 0, job_timestamp: 'i2i', sampling_step: 0, sampling_steps: 20 },
      { job_count: 1, job_no: 0, job_timestamp: 'i2i', sampling_step: 0, sampling_steps: 11 },
      { job_count: 1, job_no: 0, job_timestamp: 'i2i', sampling_step: 4, sampling_steps: 11 },
      { job_count: 0, job_timestamp: 'i2i', sampling_steps: 11 },
    ],
    pollsBeforeDone: 4,
    result: { status: 200, body: { images: [png.toString('base64')], info: '{"all_seeds":[9]}' } },
  })
  const staleRun = await new A1111Adapter({ id: 'stale', kind: 'a1111', url: 'http://web.ui', profile: 'sdxl' }, staleUi.transport).start({ ...REQUEST, image_count: 1 })
  const staleEvents = staleRun.ok ? await collect(staleRun.value) : []
  eq(
    staleEvents.map((event) => (event.type === 'start' ? `start:${event.index}:${event.steps}` : event.type === 'step' ? `step:${event.step}` : event.type)),
    ['start:0:20', 'start:0:11', 'step:4', 'image', 'done'],
    'a step count that changes after the start is announced again'
  )

  // Hires fix: the web UI counts each pass from one; the bar runs on through both.
  const hiresRun = async (id: string, hrSteps: number, progress: Record<string, unknown>[]) => {
    const webUi = scriptedWebUi({ progress, pollsBeforeDone: progress.length - 1, result: { status: 200, body: { images: [png.toString('base64')], info: '{"all_seeds":[9]}' } } })
    const run = await new A1111Adapter({ id, kind: 'a1111', url: 'http://web.ui', profile: 'sdxl' }, webUi.transport).start({
      ...REQUEST,
      image_count: 1,
      hr_scale: 2,
      hr_steps: hrSteps,
      hr_denoise: 0.4,
      hr_upscaler: 'Lanczos',
    })
    const events = run.ok ? await collect(run.value) : []
    return events.map((event) => (event.type === 'start' ? `start:${event.steps}` : event.type === 'step' ? `step:${event.step}` : event.type))
  }
  eq(
    await hiresRun('hires-own', 15, [
      { job_count: 0, job_timestamp: 'old', sampling_steps: 20 },
      { job_count: 1, job_no: 0, job_timestamp: 'hr', sampling_step: 10, sampling_steps: 20 },
      { job_count: 1, job_no: 0, job_timestamp: 'hr', sampling_step: 20, sampling_steps: 20 },
      { job_count: 1, job_no: 0, job_timestamp: 'hr', sampling_step: 3, sampling_steps: 15 },
      { job_count: 1, job_no: 0, job_timestamp: 'hr', sampling_step: 15, sampling_steps: 15 },
      { job_count: 0, job_timestamp: 'hr', sampling_steps: 15 },
    ]),
    ['start:35', 'step:10', 'step:20', 'step:23', 'step:35', 'image', 'done'],
    'hires fix with its own step count: one bar of 20 + 15, the second pass after the first'
  )
  eq(
    await hiresRun('hires-same', 0, [
      { job_count: 0, job_timestamp: 'old', sampling_steps: 20 },
      { job_count: 1, job_no: 0, job_timestamp: 'hr2', sampling_step: 12, sampling_steps: 20 },
      { job_count: 1, job_no: 0, job_timestamp: 'hr2', sampling_step: 4, sampling_steps: 20 },
      { job_count: 0, job_timestamp: 'hr2', sampling_steps: 20 },
    ]),
    ['start:40', 'step:12', 'step:24', 'image', 'done'],
    'hires fix with the same count: the step starting over begins the second pass'
  )

  // Upscale: extras first, then img2img on what it answered, its steps on their own.
  const upscaleUi = scriptedWebUi({
    progress: [
      { job_count: 0, job_timestamp: 'old' },
      { job_count: 0, job_timestamp: 'extras' },
      { job_count: 1, job_no: 0, job_timestamp: 'up', sampling_step: 6, sampling_steps: 12 },
      { job_count: 1, job_no: 0, job_timestamp: 'up', sampling_step: 12, sampling_steps: 12 },
      { job_count: 0, job_timestamp: 'up' },
    ],
    pollsBeforeDone: 4,
    result: { status: 200, body: { images: [png.toString('base64')], info: '{"all_seeds":[3]}' } },
  })
  const upscaleRun = await new A1111Adapter({ id: 'upscale', kind: 'a1111', url: 'http://web.ui', profile: 'sdxl' }, upscaleUi.transport).start(UPSCALE)
  const upscaleEvents = upscaleRun.ok ? await collect(upscaleRun.value) : []
  eq(
    upscaleEvents.map((event) => (event.type === 'start' ? `start:${event.steps}` : event.type === 'step' ? `step:${event.step}` : event.type)),
    ['start:12', 'step:6', 'step:12', 'image', 'done'],
    'upscale: one bar for the redraw, after the extras call'
  )
  const posts = upscaleUi.calls.filter((call) => call.method === 'POST')
  eq(
    [posts.map((call) => call.path), (posts[1]?.body as { init_images?: unknown })?.init_images],
    [['/sdapi/v1/extra-single-image', '/sdapi/v1/img2img'], ['UPSCALED']],
    'extras enlarges the source, and img2img redraws the picture it answered'
  )
  const refusingUi = scriptedWebUi({ progress: [{ job_count: 0, job_timestamp: 'old' }], pollsBeforeDone: 0, result: { status: 200, body: {} } })
  refusingUi.transport.post = async (path) => (path === '/sdapi/v1/extra-single-image' ? { status: 422, body: { detail: 'Upscaler not found' } } : { status: 200, body: {} })
  const extrasRefused = await new A1111Adapter({ id: 'refusing', kind: 'a1111', url: 'http://web.ui', profile: 'sdxl' }, refusingUi.transport).start(UPSCALE)
  const refusedEvents = extrasRefused.ok ? await collect(extrasRefused.value) : []
  eq(refusedEvents, [{ type: 'error', message: 'Upscaler not found' }], 'an extras refusal is the run\'s error, and nothing is drawn')
  // Asked after the run: every status call polls progress too, which would
  // otherwise use up the scripted "before" state.
  const status = await adapter.status()
  eq(
    [status.alive, status.busy, status.model, status.samplers[0], status.schedulers, status.capabilities.pose],
    [true, false, 'waiNSFW.safetensors [abc123]', 'Default', ['Default', 'Karras'], false],
    'status, the model named by its file only (no folders under the models folder)'
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
  const hiresJob = startJob({
    backend: 'hires',
    total: 1,
    steps: 1,
    context: { ...job.context, request: { ...REQUEST, hr_scale: 2, hr_steps: 10, hr_denoise: 0.4, hr_upscaler: 'Lanczos' } },
  })
  applyEvent(hiresJob, { type: 'image', index: 0, seed: 7, imageBase64: 'AA==' })
  const hiresRecord = recordFor(hiresJob, hiresJob.images[0], created, { width: 1664, height: 2432 })
  eq(
    [hiresRecord.width, hiresRecord.height, hiresRecord.hires, 'strength' in hiresRecord],
    [832, 1216, { scale: 2, steps: 10, denoise: 0.4, upscaler: 'Lanczos' }, false],
    'a hires record keeps the first pass\'s size, as A1111 does, and its hires settings'
  )
  eq('hires' in recordFor(job, job.images[0], created, null), false, 'a record without hires fix has none')
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
    { pose: { reason: 'not-reported' }, hires: { reason: 'not-reported' }, upscale: { reason: 'not-reported' } },
    'a server silent about pose, hires fix and upscale is told to report them; img2img and inpaint stay on'
  )
  eq(diffusersHints({ pose_control: true, hires: true, upscale: true, lora: false }), {}, 'LoRA support is not a hinted feature: the prompt says so where it matters')
  eq(diffusersHints({ pose_control: true, hires: true, upscale: true }), {}, 'a server with pose, hires fix, upscale and default img2img/inpaint has no hints')
  eq(diffusersHints({ pose_control: true, hires: false, upscale: true }), { hires: { reason: 'declined' } }, 'hires fix said no to is declined')
  eq(diffusersHints({ pose_control: true, hires: true, upscale: false }), { upscale: { reason: 'declined' } }, 'and so is upscale')
  eq(
    diffusersHints({ pose_control: false, inpaint: false, hires: true, upscale: true, unavailable: { pose: 'Needs a 28-layer model.' } }),
    { inpaint: { reason: 'declined' }, pose: { reason: 'declined', detail: 'Needs a 28-layer model.' } },
    "an explicit false is declined, with the server's reason when it gives one"
  )
  eq(
    diffusersHints({ hires: true, upscale: true, unavailable: { pose: 'Adapter weights missing.' } }),
    { pose: { reason: 'declined', detail: 'Adapter weights missing.' } },
    'a reason without the flag still counts as the server declining'
  )
  eq(diffusersHints({ pose_control: true, hires: true, upscale: true, unavailable: { pose: 'stale' } }), {}, 'a reason for a feature that is on is ignored')
  eq(diffusersHints({ hires: true, upscale: true, unavailable: 'nope' }), { pose: { reason: 'not-reported' } }, 'a malformed unavailable field is ignored')
  eq(hintDetail('  two\nlines\t here  '), 'two lines here', 'a reason is folded onto one line')
  eq(hintDetail(''), undefined, 'an empty reason is none')
  eq(hintDetail(42), undefined, 'a reason that is not text is none')
  const long = hintDetail('x'.repeat(500))
  check(long?.length === MAX_HINT_DETAIL && long.endsWith('…'), 'a long reason is cut to the limit')
  eq(a1111Hints(true), { pose: { reason: 'kind' } }, 'A1111 cannot take a pose, by kind')
  eq(a1111Hints(false), {}, 'an A1111 that is down gets no feature hints')

  // ── A backend open to the network without a login ──
  const open = (kind: 'diffusers' | 'a1111' | 'comfyui', url: string, hasToken = false) => openBackendWarning({ kind, url, hasToken })
  eq(open('comfyui', 'http://127.0.0.1:8188'), null, 'a ComfyUI on this computer is fine')
  eq(open('comfyui', 'http://localhost:8188'), null, 'so is localhost')
  eq(open('comfyui', 'http://127.0.0.2:8188'), null, 'and any 127.x address')
  eq(open('a1111', 'http://[::1]:7860'), null, 'and IPv6 loopback')
  eq(open('comfyui', 'http://192.168.1.20:8188'), 'comfyui', 'a ComfyUI on the LAN is warned about')
  eq(open('comfyui', 'http://gpu-box:8188/'), 'comfyui', 'so is one by host name')
  eq(open('comfyui', 'http://0.0.0.0:8188'), 'comfyui', 'and one listening on every address')
  eq(open('a1111', ' http://10.0.0.5:7860 '), 'a1111', 'an A1111 on the LAN without a token is warned about')
  eq(open('a1111', 'http://10.0.0.5:7860', true), null, 'not with a token')
  eq(open('comfyui', 'https://comfy.example.lan', true), null, 'nor a ComfyUI behind a proxy with a token')
  eq(open('diffusers', 'http://192.168.1.20:7865'), null, 'a diffusers-compatible server is not')
  eq(open('comfyui', 'not a url'), null, 'an address that cannot be read is left to the field check')
  eq(open('comfyui', ''), null, 'nor is an empty one')

  // ── Why a backend is down ──
  eq(problemOf(null), { reason: 'unreachable' }, 'no answer at all')
  eq(problemOf({ status: 200, body: {} }), null, 'a 2xx is no problem')
  eq(problemOf({ status: 401, body: { detail: 'Not authenticated' } }), { reason: 'auth', status: 401, detail: 'Not authenticated' }, 'a 401 is a login, with its words')
  eq(problemOf({ status: 403, body: null }), { reason: 'auth', status: 403 }, 'so is a 403')
  eq(problemOf({ status: 502, body: { error: REDIRECT_REFUSED } }), { reason: 'redirect' }, 'a refused redirect')
  const broken500 = problemOf({ status: 500, body: { error: 'failed in C:\\Users\\someone\\x.py' } })
  check(broken500?.reason === 'http' && broken500.status === 500 && !broken500.detail?.includes('someone'), 'another status, its words without paths')
  const locked = ({ status, body }: { status: number; body: unknown }): A1111Transport => ({
    get: async (path) => (path.startsWith('/sdapi/v1/progress') ? { status, body } : { status: 404, body: null }),
    post: async () => ({ status: 404, body: null }),
    sleep: async () => {},
  })
  const lockedUi = await new A1111Adapter({ id: 'locked', kind: 'a1111', url: 'http://web.ui', profile: 'generic' }, locked({ status: 401, body: { detail: 'Not authenticated' } })).status()
  eq([lockedUi.alive, lockedUi.problem], [false, { reason: 'auth', status: 401, detail: 'Not authenticated' }], 'A1111 started with --api-auth and no token: down, as a login')
  const upUi = await new A1111Adapter({ id: 'up', kind: 'a1111', url: 'http://web.ui', profile: 'generic' }, scriptedWebUi({ progress: [{}], pollsBeforeDone: 0, result: { status: 200, body: {} } }).transport).status()
  eq([upUi.alive, upUi.problem], [true, undefined], 'an A1111 that answers has no problem')
  eq([upUi.capabilities.hires, upUi.upscalers], [true, ['Lanczos']], 'an A1111 that lists no upscalers still has its built-in Lanczos')
  const upscaling: A1111Transport = {
    get: async (path) =>
      path.startsWith('/sdapi/v1/progress')
        ? { status: 200, body: { state: {} } }
        : path === '/sdapi/v1/samplers'
          ? { status: 200, body: [{ name: 'Euler a' }] }
          : path === '/sdapi/v1/upscalers'
            ? {
                status: 200,
                body: [
                  { name: 'None', model_path: null },
                  { name: 'Lanczos', model_path: null },
                  { name: 'ESRGAN', model_path: 'https://github.com/cszn/KAIR/releases/download/v1.0/ESRGAN.pth' },
                  { name: 'R-ESRGAN 4x+', model_path: 'C:\\webui\\models\\RealESRGAN\\RealESRGAN_x4plus.pth' },
                ],
              }
            : path === '/sdapi/v1/latent-upscale-modes'
              ? { status: 200, body: [{ name: 'Latent' }] }
              : { status: 404, body: null },
    post: async () => ({ status: 404, body: null }),
    sleep: async () => {},
  }
  eq(
    (await new A1111Adapter({ id: 'upscaling', kind: 'a1111', url: 'http://web.ui', profile: 'generic' }, upscaling).status()).upscalers,
    ['Lanczos', 'R-ESRGAN 4x+', 'Latent'],
    'its upscalers, then its latent modes; "None" is no upscaler, and one that would be downloaded is left out'
  )

  // ── Hires fix in a request ──
  const parsed = (body: Record<string, unknown>) => toGenerateRequest({ prompt: 'x', width: 1024, height: 1024, ...body })
  const asked = parsed({ hr_scale: 1.5, hr_steps: 12.4, hr_denoise: 0.3, hr_upscaler: 'R-ESRGAN 4x+' })
  eq([asked?.hr_scale, asked?.hr_steps, asked?.hr_denoise, asked?.hr_upscaler], [1.5, 12, 0.3, 'R-ESRGAN 4x+'], 'hires fix fields are read')
  eq('hr_scale' in (parsed({}) ?? {}), false, 'no hires fix unless asked')
  eq(parsed({ hr_scale: 9, hr_denoise: 5, hr_steps: -3 })?.hr_scale, 4, 'the scale is held to 4096 a side')
  eq(parsed({ width: 2048, hr_scale: 3 })?.hr_scale, 2, 'and to 4096 for the longer side')
  eq(parsed({ hr_scale: 2, hr_upscaler: 'a\nb' })?.hr_upscaler, 'Lanczos', 'an upscaler name with control characters falls back to Lanczos')
  eq('hr_scale' in (parsed({ hr_scale: 2, init_image_base64: 'AAAA' }) ?? {}), false, 'not with a source image: that run is img2img')
  eq('hr_scale' in (parsed({ hr_scale: 2, workflow: 'mine' }) ?? {}), false, 'nor with a workflow, which has its own passes')

  // ── Upscale in a request ──
  const upscaled = parsed({
    upscale: true,
    init_image_base64: 'AAAA',
    strength: 0.6,
    mask_base64: 'BBBB',
    pose_image_base64: 'CCCC',
    workflow: 'mine',
    hr_scale: 3,
    hr_steps: 8,
    hr_denoise: 0.3,
  })
  eq(
    [upscaled?.upscale, upscaled?.init_image_base64, upscaled?.hr_scale, upscaled?.hr_denoise, 'strength' in (upscaled ?? {}), 'mask_base64' in (upscaled ?? {}), 'pose_image_base64' in (upscaled ?? {}), 'workflow' in (upscaled ?? {})],
    [true, 'AAAA', 3, 0.3, false, false, false, false],
    'upscale keeps the source and hr_* (its scale held to 4 here; the backend holds the sides to 4096) and drops the rest'
  )
  eq(modeOf(upscaled!), 'upscale', 'its mode is upscale')
  eq('upscale' in (parsed({ upscale: true, hr_scale: 2 }) ?? {}), false, 'no upscale without a source')
  const sourceOnly = parsed({ upscale: true, init_image_base64: 'AAAA', strength: 0.5 })
  eq([sourceOnly?.upscale, sourceOnly?.strength], [undefined, 0.5], 'nor without hr_*: then it is plain img2img')

  // ── A1111's lists are per server ──
  const served = (name: string): A1111Transport => ({
    get: async (path) =>
      path.startsWith('/sdapi/v1/progress') ? { status: 200, body: { state: {} } } : path === '/sdapi/v1/samplers' ? { status: 200, body: [{ name }] } : { status: 404, body: null },
    post: async () => ({ status: 404, body: null }),
    sleep: async () => {},
  })
  const first = await new A1111Adapter({ id: 'moved', kind: 'a1111', url: 'http://one.test', profile: 'generic' }, served('Euler a')).status()
  const moved = await new A1111Adapter({ id: 'moved', kind: 'a1111', url: 'http://two.test', profile: 'generic' }, served('DDIM')).status()
  eq([first.samplers, moved.samplers], [['Default', 'Euler a'], ['Default', 'DDIM']], 'a backend moved to another server lists that server\'s samplers at once')

  // ── Redirects are refused, not followed ──
  // A backend that answers 307 must not get the prompt or the token sent on.
  const elsewhere = await listen(() => 200)
  const redirecting = await listen(() => [307, `${elsewhere.url}/stolen`])
  const diffusers = new DiffusersAdapter({ id: 'r', kind: 'diffusers', url: redirecting.url, profile: 'generic', token: 'secret' })
  const redirected = await diffusers.start(REQUEST)
  check(!redirected.ok && redirected.status === 502 && redirected.error === REDIRECT_REFUSED, 'diffusers: a redirected generate is refused with a clear error')
  const redirectedHealth = await diffusers.status()
  check(!redirectedHealth.alive, 'diffusers: a redirected health check is not alive')
  eq(redirectedHealth.problem, { reason: 'redirect' }, 'diffusers: and the page is told it redirected')
  const lockedServer = await listen(() => 401)
  eq((await new DiffusersAdapter({ id: 'l', kind: 'diffusers', url: lockedServer.url, profile: 'generic' }).status()).problem, { reason: 'auth', status: 401 }, 'diffusers: a real 401 reads as a login')
  lockedServer.server.close()
  const nobody = await listen(() => 200)
  nobody.server.close()
  eq((await new DiffusersAdapter({ id: 'n', kind: 'diffusers', url: nobody.url, profile: 'generic' }).status()).problem, { reason: 'unreachable' }, 'diffusers: nothing listening is unreachable')
  const a1111 = new A1111Adapter({ id: 'r', kind: 'a1111', url: redirecting.url, profile: 'generic', token: 'secret' })
  check(!(await a1111.status()).alive, 'A1111: a redirected status is not alive')
  eq(elsewhere.hits, [], 'nothing reached the address the redirect pointed at')
  check(redirecting.hits.length > 0, 'the backend itself was asked')
  elsewhere.server.close()
  redirecting.server.close()

  done('backends')
}

/** A local server that records each request and answers with `reply`'s status (and Location). */
async function listen(reply: () => number | [number, string]) {
  const hits: string[] = []
  const server = createServer((request, response) => {
    hits.push(`${request.method} ${request.url}`)
    request.resume()
    const answer = reply()
    const [status, location] = Array.isArray(answer) ? answer : [answer, undefined]
    response.writeHead(status, { 'Content-Type': 'application/json', ...(location ? { Location: location } : {}) })
    response.end('{}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, hits, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }
}

void main()
