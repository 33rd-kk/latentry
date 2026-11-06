// The stable-diffusion.cpp sd-server adapter against a pretend server: its
// capabilities, the img_gen body it sends, the events it makes of the job
// polls, and that Cancel only ever names its own job.

import { createServer } from 'node:http'
import sharp from 'sharp'
import { check, done, eq } from './assert'
import type { A1111Transport } from '../lib/backends/a1111-transport'
import { openBackendWarning } from '../lib/backends/exposure'
import { sdcppHints } from '../lib/backends/hints'
import { SdcppAdapter } from '../lib/backends/sdcpp'
import { parseCapabilities, previewMode, seedOf, toSdcppPlan, upscalerList, type SdcppPlan } from '../lib/backends/sdcpp-payload'
import type { BackendConfig, BackendEvent, GenerateRequest } from '../lib/backends/types'

const REQUEST: GenerateRequest = {
  prompt: '1girl, <lora:Ink Style:0.7>, smile',
  negative_prompt: 'lowres',
  width: 832,
  height: 1216,
  seed: 5,
  image_count: 2,
  sampler: 'Default',
  scheduler: 'karras',
  num_inference_steps: 20,
  guidance_scale: 5,
}

const CAPS = {
  model: { name: 'z_image_turbo-Q4_K.gguf', stem: 'z_image_turbo-Q4_K', path: 'C:\\Users\\me\\models\\z_image_turbo-Q4_K.gguf' },
  supported_modes: ['img_gen'],
  features_by_mode: { img_gen: { init_image: true, mask_image: true, lora: true, hires: true, preview: true, control_image: false } },
  samplers: ['euler', 'euler_a', 'dpm++2m'],
  schedulers: ['discrete', 'karras'],
  loras: [{ name: 'ink style', path: 'styles/ink style.safetensors', display_path: 'styles/ink style.safetensors' }],
  upscalers: [
    { name: 'None', model: false, image_upscale: false },
    { name: 'Lanczos', model: false, image_upscale: false },
    { name: 'Latent', model: false, image_upscale: false },
    { name: '4x-AnimeSharp', model: true, image_upscale: true },
  ],
  preview_modes: ['none', 'proj', 'tae', 'vae'],
  runtime: { state: 'ready', error: null },
}

const CONFIG: BackendConfig = { id: 'cpp', kind: 'sdcpp', url: 'http://127.0.0.1:1234', profile: 'generic' }

async function collect(events: AsyncIterable<BackendEvent>): Promise<BackendEvent[]> {
  const all: BackendEvent[] = []
  for await (const event of events) all.push(event)
  return all
}

/**
 * A pretend sd-server. Each submitted job walks through `script` (one entry
 * per poll); the last entry is where it stays.
 */
function scriptedServer(options: {
  caps?: { status: number; body: unknown }
  script?: (job: number) => Record<string, unknown>[]
  submit?: { status: number; body: unknown }
  onPoll?: (job: number, poll: number) => void
}) {
  const calls: { method: string; path: string; body?: unknown }[] = []
  const polls = new Map<string, number>()
  let jobs = 0
  const cancelled = new Set<string>()
  const transport: A1111Transport = {
    async get(path) {
      calls.push({ method: 'GET', path })
      if (path === '/sdcpp/v1/capabilities') return options.caps ?? { status: 200, body: CAPS }
      const match = /^\/sdcpp\/v1\/jobs\/(job_(\d+))$/.exec(path)
      if (match) {
        const job = Number(match[2])
        const poll = polls.get(match[1]) ?? 0
        polls.set(match[1], poll + 1)
        options.onPoll?.(job, poll)
        if (cancelled.has(match[1])) return { status: 200, body: { id: match[1], status: 'cancelled', error: { code: 'cancelled', message: 'job cancelled by client' } } }
        const script = options.script?.(job) ?? []
        return { status: 200, body: { id: match[1], ...script[Math.min(poll, script.length - 1)] } }
      }
      return { status: 404, body: null }
    },
    async post(path, body) {
      calls.push({ method: 'POST', path, body })
      if (path === '/sdcpp/v1/img_gen') {
        if (options.submit) return options.submit
        jobs += 1
        return { status: 202, body: { id: `job_${jobs}`, kind: 'img_gen', status: 'queued', poll_url: `/sdcpp/v1/jobs/job_${jobs}` } }
      }
      const cancel = /^\/sdcpp\/v1\/jobs\/(job_\d+)\/cancel$/.exec(path)
      if (cancel) {
        cancelled.add(cancel[1])
        return { status: 200, body: { id: cancel[1], cancel_requested: true } }
      }
      if (path === '/sdcpp/v1/upscale') {
        const big = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#808080' } }).png().toBuffer()
        return { status: 200, body: { images: [{ index: 0, b64_json: big.toString('base64') }], scale: 4 } }
      }
      return { status: 404, body: null }
    },
    sleep: () => new Promise((resolve) => setTimeout(resolve, 1)),
  }
  return { transport, calls }
}

const completed = (seed: string) => ({ status: 'completed', result: { output_format: 'png', images: [{ index: 0, b64_json: `PIC${seed}`, generation_info: { seed } }] } })

async function main() {
  // ── Capabilities ──
  const info = parseCapabilities(CAPS)
  eq(info.model, 'z_image_turbo-Q4_K', 'the model is named by its stem, never its path')
  check(info.ready, 'a loaded model is ready')
  eq([...info.features].sort(), ['hires', 'init_image', 'lora', 'mask_image', 'preview'], 'only the features set to true')
  eq(upscalerList(info), ['Lanczos', 'Latent', '4x-AnimeSharp'], 'upscalers: Lanczos first, None left out')
  eq(previewMode(info), 'proj', 'the cheapest preview that still reports steps')
  eq(previewMode(parseCapabilities({ ...CAPS, preview_modes: ['none'] })), 'none', 'none when it has no projection')
  const empty = parseCapabilities({ ...CAPS, runtime: { state: 'empty', error: null }, model: {} })
  check(!empty.ready && empty.model === null, 'no model loaded is not ready')
  eq(empty.notReady, 'No model is ready (empty)', 'and says why')
  const failed = parseCapabilities({ ...CAPS, runtime: { state: 'error', error: 'cannot open C:\\Users\\me\\models\\x.gguf' } })
  eq(failed.notReady, 'cannot open <path>', 'its error comes along without paths')
  check(parseCapabilities({ ...CAPS, supported_modes: ['vid_gen'] }).ready === false, 'a video-only server cannot draw pictures')
  const legacy = parseCapabilities({ ...CAPS, features_by_mode: undefined, features: { init_image: true } })
  eq([...legacy.features], ['init_image'], 'an older server: the top-level mirror')
  eq(parseCapabilities(null).samplers, [], 'nonsense reads as nothing')

  eq(sdcppHints(true, { img2img: true, inpaint: true, hires: true }), { pose: { reason: 'kind' } }, 'pose is never something Latentry drives there')
  eq(
    sdcppHints(true, { img2img: false, inpaint: false, hires: false }),
    { pose: { reason: 'kind' }, img2img: { reason: 'declined' }, upscale: { reason: 'declined' }, inpaint: { reason: 'declined' }, hires: { reason: 'declined' } },
    'what the loaded model lacks is the server declining it'
  )
  eq(sdcppHints(false, { img2img: false, inpaint: false, hires: false }), {}, 'no hints while down')

  // ── The job body ──
  const plan = (await toSdcppPlan(REQUEST, info, 64)) as SdcppPlan
  check(typeof plan === 'object', 'a txt2img plan')
  eq(plan.body.prompt, '1girl, smile', 'LoRA calls are taken out of the prompt')
  eq(plan.body.lora, [{ path: 'styles/ink style.safetensors', multiplier: 0.7 }], 'and sent by the path id the server listed, matched by name')
  eq(plan.loras, [{ name: 'Ink Style', weight: 0.7 }], 'the record says which LoRAs were applied')
  eq(plan.body.sample_params, { sample_steps: 20, guidance: { txt_cfg: 5 }, scheduler: 'karras' }, 'Default leaves the sampler to the server')
  eq([plan.body.batch_count, plan.body.embed_image_metadata, plan.body.preview, plan.body.output_format], [1, false, 'proj', 'png'], 'one picture per job, no server metadata, a step preview, PNG')
  check(!('init_image' in plan.body) && !('hires' in plan.body), 'nothing it was not asked for')
  eq([plan.steps, plan.firstPass], [20, 20], 'steps for the bar')

  eq(await toSdcppPlan({ ...REQUEST, prompt: '<lora:gone:1> x' }, info, 64), 'LoRA not found on this backend: gone', 'an unknown LoRA is refused')
  eq(
    await toSdcppPlan(REQUEST, { ...info, features: new Set(['init_image']) }, 64),
    'This backend does not load LoRAs',
    'LoRA calls on a model without LoRA support are refused, not read as words'
  )
  eq(await toSdcppPlan({ ...REQUEST, pose_image_base64: 'x' }, info, 64), 'Pose control is not available on this backend', 'pose is refused')

  const hires = (await toSdcppPlan({ ...REQUEST, prompt: '1girl', hr_scale: 1.5, hr_steps: 8, hr_denoise: 0.35, hr_upscaler: '4x-AnimeSharp' }, info, 64)) as SdcppPlan
  eq(hires.body.hires, { enabled: true, upscaler: '4x-AnimeSharp', scale: 1.5, steps: 8, denoising_strength: 0.35 }, 'hires fix in its own words')
  eq([hires.steps, hires.firstPass], [28, 20], 'the bar runs on through the second pass')
  eq(
    await toSdcppPlan({ ...REQUEST, prompt: '1girl', hr_scale: 2 }, { ...info, features: new Set(['lora']) }, 64),
    'Hires fix is not available with the model this backend has loaded',
    'hires fix is refused when the model lacks it'
  )

  const source = (await sharp({ create: { width: 64, height: 96, channels: 4, background: '#336699ff' } }).png().toBuffer()).toString('base64')
  const mask = (await sharp({ create: { width: 64, height: 96, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer()).toString('base64')
  const inpaint = (await toSdcppPlan({ ...REQUEST, prompt: '1girl', width: 512, height: 512, init_image_base64: `data:image/png;base64,${source}`, mask_base64: mask, strength: 0.5 }, info, 64)) as SdcppPlan
  eq([inpaint.body.width, inpaint.body.height], [448, 640], 'img2img fits the source aspect')
  check(typeof inpaint.body.init_image === 'string' && !(inpaint.body.init_image as string).startsWith('data:'), 'the source goes as bare base64')
  const maskMeta = await sharp(Buffer.from(inpaint.body.mask_image as string, 'base64')).metadata()
  eq([maskMeta.channels, maskMeta.width, maskMeta.height], [1, 448, 640], 'the mask is one channel, at the run size')
  eq([inpaint.body.strength, inpaint.steps], [0.5, 10], 'strength, and the steps an img2img actually runs')
  eq(
    await toSdcppPlan({ ...REQUEST, prompt: '1girl', init_image_base64: source, mask_base64: mask }, { ...info, features: new Set(['init_image']) }, 64),
    'An inpaint mask is not available with the model this backend has loaded',
    'a mask is refused when the model lacks it'
  )

  const upscale = (await toSdcppPlan({ ...REQUEST, prompt: '1girl', init_image_base64: source, upscale: true, hr_scale: 2, hr_steps: 6, hr_denoise: 0.3, hr_upscaler: '4x-AnimeSharp' }, info, 64)) as SdcppPlan
  eq(upscale.enlarge && { ...upscale.enlarge, source: '…' }, { source: '…', width: 128, height: 192, model: '4x-AnimeSharp', kernel: 'lanczos3' }, 'an upscale enlarges by the ESRGAN model to the exact size')
  eq([upscale.body.width, upscale.body.height, upscale.body.strength, upscale.steps], [128, 192, 0.3, 6], 'then redraws at the hires denoise for the hires steps')
  eq(
    await toSdcppPlan({ ...REQUEST, prompt: '1girl', init_image_base64: source, upscale: true, hr_scale: 2, hr_upscaler: 'Latent' }, info, 64),
    'This upscaler cannot enlarge a picture on its own: Latent',
    'a latent upscaler cannot enlarge a picture'
  )

  eq(seedOf({ generation_info: { seed: '123' } }), 123, 'the seed is a decimal string')
  eq(seedOf({ generation_info: { seed: '18446744073709551615' } }), null, 'one past a safe integer is not trusted')

  // ── Status ──
  const up = await new SdcppAdapter(CONFIG, scriptedServer({}).transport).status()
  check(up.alive && up.model === 'z_image_turbo-Q4_K', 'alive, with the model')
  eq(up.capabilities, { img2img: true, inpaint: true, pose: false, tag: false, lora: true, presets: false, preciseCancel: true, hires: true, upscale: true }, 'capabilities from its features')
  eq([up.samplers[0], up.schedulers.length, up.upscalers.length], ['Default', 3, 3], 'Default first; its lists')
  const noModel = await new SdcppAdapter(CONFIG, scriptedServer({ caps: { status: 200, body: { ...CAPS, runtime: { state: 'empty' } } } }).transport).status()
  check(!noModel.alive && noModel.problem?.status === 503 && noModel.problem.detail === 'No model is ready (empty)', 'no model loaded: not usable, and why')
  const loading = await new SdcppAdapter(CONFIG, scriptedServer({ caps: { status: 503, body: { error: 'Model is loading', code: 'model_loading' } } }).transport).status()
  eq(loading.problem, { reason: 'http', status: 503, detail: 'Model is loading' }, 'its 503 says why')

  // ── A run ──
  const server = scriptedServer({
    script: (job) => [
      { status: 'queued', preview: null },
      { status: 'generating', preview: { pass: 1, step: 5, total_steps: 20 } },
      { status: 'generating', preview: { pass: 1, step: 20, total_steps: 20 } },
      completed(String(4 + job)),
    ],
  })
  const run = await new SdcppAdapter({ ...CONFIG, id: 'run' }, server.transport).start(REQUEST)
  check(run.ok, 'the run starts')
  const events = run.ok ? await collect(run.value) : []
  eq(
    events.map((event) => [event.type, 'index' in event ? event.index : null, 'step' in event ? event.step : 'seed' in event ? event.seed : null]),
    [
      ['start', 0, null],
      ['step', 0, 5],
      ['step', 0, 20],
      ['image', 0, 5],
      ['start', 1, null],
      ['step', 1, 5],
      ['step', 1, 20],
      ['image', 1, 6],
      ['done', null, null],
    ],
    'one job per picture: start, steps, its picture with its own seed'
  )
  const submitted = server.calls.filter((call) => call.path === '/sdcpp/v1/img_gen').map((call) => (call.body as { seed: number }).seed)
  eq(submitted, [5, 6], 'seeds count up from the asked one')
  eq((events[0] as { runId?: string }).runId, 'job_1', 'the run is named by its first job')
  eq((events[4] as { runId?: string }).runId, 'job_1', 'and keeps that name')
  eq((events[3] as { loras?: unknown }).loras, [{ name: 'Ink Style', weight: 0.7 }], 'each picture says its LoRAs')

  const random = scriptedServer({ script: () => [completed('77')] })
  const randomRun = await new SdcppAdapter({ ...CONFIG, id: 'random' }, random.transport).start({ ...REQUEST, prompt: '1girl', seed: -1, image_count: 1 })
  const randomEvents = randomRun.ok ? await collect(randomRun.value) : []
  const randomSeed = (random.calls.find((call) => call.path === '/sdcpp/v1/img_gen')?.body as { seed: number }).seed
  check(Number.isInteger(randomSeed) && randomSeed >= 0, 'a random run asks for a seed chosen here')
  eq((randomEvents.find((event) => event.type === 'image') as { seed: number }).seed, 77, 'the seed the server reports wins')

  const corrected = scriptedServer({ script: () => [{ status: 'generating', preview: { pass: 1, step: 3, total_steps: 12 } }, completed('1')] })
  const correctedRun = await new SdcppAdapter({ ...CONFIG, id: 'tail' }, corrected.transport).start({ ...REQUEST, prompt: '1girl', image_count: 1 })
  const correctedEvents = correctedRun.ok ? await collect(correctedRun.value) : []
  eq(
    correctedEvents.filter((event) => event.type === 'start').map((event) => (event as { steps: number }).steps),
    [20, 12],
    'the server\u2019s own step count, announced again'
  )

  const twoPass = scriptedServer({
    script: () => [
      { status: 'generating', preview: { pass: 1, step: 20, total_steps: 20 } },
      { status: 'generating', preview: { pass: 2, step: 4, total_steps: 8 } },
      completed('1'),
    ],
  })
  const twoPassRun = await new SdcppAdapter({ ...CONFIG, id: 'hires' }, twoPass.transport).start({ ...REQUEST, prompt: '1girl', image_count: 1, hr_scale: 1.5, hr_steps: 8 })
  const twoPassEvents = twoPassRun.ok ? await collect(twoPassRun.value) : []
  eq(twoPassEvents.filter((event) => event.type === 'step').map((event) => (event as { step: number }).step), [20, 24], 'the second pass counts on after the first')

  const failing = scriptedServer({ script: () => [{ status: 'failed', error: { code: 'generation_failed', message: 'out of memory at D:\\sd\\model.gguf' } }] })
  const failRun = await new SdcppAdapter({ ...CONFIG, id: 'fail' }, failing.transport).start({ ...REQUEST, prompt: '1girl' })
  const failEvents = failRun.ok ? await collect(failRun.value) : []
  eq(failEvents.at(-1), { type: 'error', message: 'out of memory at <path>' }, 'a failed job ends the run with its reason, no paths')
  eq(failing.calls.filter((call) => call.path === '/sdcpp/v1/img_gen').length, 1, 'and no further picture is asked for')

  const gone = scriptedServer({})
  gone.transport.get = async (path) => (path === '/sdcpp/v1/capabilities' ? { status: 200, body: CAPS } : { status: 410, body: { error: 'gone' } })
  const goneRun = await new SdcppAdapter({ ...CONFIG, id: 'gone' }, gone.transport).start({ ...REQUEST, prompt: '1girl' })
  const goneEvents = goneRun.ok ? await collect(goneRun.value) : []
  eq(goneEvents.at(-1)?.type, 'error', 'a job the server no longer has is an error')

  const full = await new SdcppAdapter({ ...CONFIG, id: 'full' }, scriptedServer({ submit: { status: 429, body: { error: 'queue full' } } }).transport).start({ ...REQUEST, prompt: '1girl' })
  const fullEvents = full.ok ? await collect(full.value) : []
  eq(fullEvents.at(-1), { type: 'error', message: 'The backend\u2019s queue is full; try again in a moment' }, 'a full queue says so')

  const refused = await new SdcppAdapter({ ...CONFIG, id: 'nomodel' }, scriptedServer({ caps: { status: 200, body: { ...CAPS, runtime: { state: 'empty' } } } }).transport).start(REQUEST)
  eq(refused, { ok: false, status: 503, error: 'No model is ready (empty)' }, 'no run without a model')
  const badLora = await new SdcppAdapter({ ...CONFIG, id: 'badlora' }, scriptedServer({}).transport).start({ ...REQUEST, prompt: '<lora:gone:1>' })
  eq(badLora, { ok: false, status: 400, error: 'LoRA not found on this backend: gone' }, 'a refusal before any job')

  // ── An upscale enlarges first ──
  const up2 = scriptedServer({ script: () => [completed('1')] })
  const upRun = await new SdcppAdapter({ ...CONFIG, id: 'up' }, up2.transport).start({
    ...REQUEST,
    prompt: '1girl',
    image_count: 1,
    init_image_base64: source,
    upscale: true,
    hr_scale: 2,
    hr_upscaler: '4x-AnimeSharp',
  })
  const upEvents = upRun.ok ? await collect(upRun.value) : []
  eq(up2.calls.filter((call) => call.method === 'POST').map((call) => call.path), ['/sdcpp/v1/upscale', '/sdcpp/v1/img_gen'], 'the ESRGAN model, then the redraw')
  const redraw = up2.calls.find((call) => call.path === '/sdcpp/v1/img_gen')?.body as { init_image: string }
  const redrawMeta = await sharp(Buffer.from(redraw.init_image, 'base64')).metadata()
  eq([redrawMeta.width, redrawMeta.height], [128, 192], 'resized to the exact target')
  eq(upEvents.at(-1)?.type, 'done', 'the upscale finishes')

  // ── Cancel names only our job ──
  let adapter: SdcppAdapter | null = null
  let cancelled: unknown = null
  const cancelServer = scriptedServer({
    script: () => [{ status: 'generating', preview: { pass: 1, step: 2, total_steps: 20 } }],
    onPoll: (job, poll) => {
      if (job === 1 && poll === 1 && adapter) void adapter.cancel('job_1').then((outcome) => (cancelled = outcome))
    },
  })
  adapter = new SdcppAdapter({ ...CONFIG, id: 'cancel' }, cancelServer.transport)
  const cancelRun = await adapter.start(REQUEST)
  const cancelEvents = cancelRun.ok ? await collect(cancelRun.value) : []
  eq(cancelled, { ok: true, value: { status: 'cancelling' } }, 'cancel answers at once')
  eq(cancelEvents.at(-1)?.type, 'cancelled', 'the run ends cancelled')
  eq(
    cancelServer.calls.filter((call) => call.path.endsWith('/cancel')).map((call) => call.path),
    ['/sdcpp/v1/jobs/job_1/cancel'],
    'only our own job is cancelled, by its id'
  )
  eq(cancelServer.calls.filter((call) => call.path === '/sdcpp/v1/img_gen').length, 1, 'and the next picture is not asked for')
  eq(await adapter.cancel('job_1'), { ok: true, value: { status: 'idle' } }, 'nothing to cancel afterwards')

  const busyServer = scriptedServer({ script: () => [{ status: 'generating', preview: null }] })
  const busyAdapter = new SdcppAdapter({ ...CONFIG, id: 'busy' }, busyServer.transport)
  const first = await busyAdapter.start({ ...REQUEST, prompt: '1girl' })
  const second = await busyAdapter.start({ ...REQUEST, prompt: '1girl' })
  eq(second, { ok: false, status: 409, error: 'This backend is already generating for Latentry' }, 'one Latentry run at a time per backend')
  check((await busyAdapter.status()).busy, 'busy while it runs')
  if (first.ok) {
    const iterator = first.value[Symbol.asyncIterator]()
    await iterator.next()
    eq(await busyAdapter.cancel('someone-else'), { ok: false, status: 409, error: 'That run has already ended' }, 'another run id is not ours to stop')
    // The page goes away: leaving the stream stops the job on the server.
    await iterator.return?.(undefined)
  }
  eq(busyServer.calls.filter((call) => call.path.endsWith('/cancel')).map((call) => call.path), ['/sdcpp/v1/jobs/job_1/cancel'], 'a run left early cancels its job')
  check(!(await busyAdapter.status()).busy, 'and the backend is free again')

  // ── Settings warning ──
  eq(openBackendWarning({ kind: 'sdcpp', url: 'http://127.0.0.1:1234', hasToken: false }), null, 'an sd-server on this computer is fine')
  eq(openBackendWarning({ kind: 'sdcpp', url: 'http://192.168.1.20:1234', hasToken: false }), 'sdcpp', 'one on the network without a token is warned about')
  eq(openBackendWarning({ kind: 'sdcpp', url: 'https://sd.example.net', hasToken: true }), null, 'a proxy with a token is not')

  // The Bearer header for a proxy in front of it.
  const seen: Record<string, string> = {}
  const listener = createServer((req, res) => {
    seen.auth = req.headers.authorization ?? ''
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(CAPS))
  })
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve))
  const port = (listener.address() as { port: number }).port
  const real = await new SdcppAdapter({ ...CONFIG, id: 'bearer', url: `http://127.0.0.1:${port}`, token: 'tok' }).status()
  listener.close()
  check(real.alive, 'reaches a real HTTP server')
  eq(seen.auth, 'Bearer tok', 'the token goes as a Bearer token')

  done('sdcpp')
}

void main()
