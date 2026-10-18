/**
 * The ComfyUI backend (lib/backends/comfyui.ts): the graph it builds, a run
 * against a scripted ComfyUI (with and without the progress socket), cancel,
 * refusals, and a whole generation through the API routes against
 * fixtures/mock-comfyui.ts, saved without ComfyUI's graph chunks.
 *
 * Run with: npm test -- comfyui
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { check, done, eq } from './assert'
import { startMockComfyUI } from './fixtures/mock-comfyui'
import {
  buildComfyGraph,
  comboOptions,
  ComfyUIAdapter,
  OUTPUT_NODE,
  resolveLoras,
  resolveUpscaler,
  upscalerNames,
  withoutLoraCalls,
  type ComfyTransport,
} from '../lib/backends/comfyui'
import { comfyHints } from '../lib/backends/hints'
import { REDIRECT_REFUSED } from '../lib/backends/http'
import { isResumable, keptFor, markSecret, SECRET_GRACE_MS, startJob } from '../lib/diffusion/job-store'
import { fitToImage } from '../lib/profiles'
import { isPng, readPngText, writePngText } from '../lib/image-meta'
import { validateSettings } from '../lib/settings/schema'
import type { BackendConfig, BackendEvent, GenerateRequest } from '../lib/backends/types'

const REQUEST: GenerateRequest = {
  prompt: '1girl, <lora:ink:0.7>, smile',
  negative_prompt: 'lowres',
  width: 830,
  height: 1216,
  seed: 5,
  image_count: 2,
  sampler: 'Default',
  scheduler: 'karras',
  num_inference_steps: 2,
  guidance_scale: 5,
}

const CONFIG: BackendConfig = { id: 'comfy', kind: 'comfyui', url: 'http://comfy.test/', profile: 'sdxl' }

async function collect(events: AsyncIterable<BackendEvent>): Promise<BackendEvent[]> {
  const all: BackendEvent[] = []
  for await (const event of events) all.push(event)
  return all
}

/**
 * A pretend ComfyUI. Each queued prompt finishes on its own (over the socket
 * when there is one, else in /history), unless `hold` keeps it running until
 * an interrupt.
 */
async function scriptedComfy(
  options: {
    socket?: boolean
    busy?: boolean
    hold?: boolean
    refuse?: unknown
    fail?: string
    controlnet?: boolean
    /** UpscaleModelLoader's files; without them, ComfyUI has no such node. */
    upscalers?: string[]
    /** The progress messages each prompt sends (its prompt_id is added), in place of two steps. */
    progress?: Record<string, unknown>[]
  } = {}
) {
  const png = writePngText(await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123' } }).png().toBuffer(), {
    prompt: '{"1":{"class_type":"CheckpointLoaderSimple","inputs":{"ckpt_name":"secret/folder/base.safetensors"}}}',
    workflow: '{"nodes":[]}',
    other: 'kept',
  })
  const calls: string[] = []
  const graphs: Record<string, { class_type: string; inputs: Record<string, unknown> }>[] = []
  const clients: string[] = []
  const running = new Set<string>()
  const history = new Map<string, unknown>()
  const uploads: { name: string; subfolder: string; png: Buffer }[] = []
  const deleted: string[] = []
  const state = { hold: options.hold === true }
  let send: ((message: unknown) => void) | null = null

  const finish = (id: string, how: 'success' | 'interrupted' | 'error') => {
    running.delete(id)
    const messages: [string, Record<string, unknown>][] =
      how === 'interrupted' ? [['execution_interrupted', { prompt_id: id }]] : how === 'error' ? [['execution_error', { prompt_id: id, exception_message: options.fail }]] : []
    history.set(id, {
      outputs: how === 'success' ? { [OUTPUT_NODE]: { images: [{ filename: `${id}.png`, subfolder: '', type: 'temp' }] } } : {},
      status: { status_str: how === 'success' ? 'success' : 'error', messages },
    })
    if (!send) return
    if (how === 'interrupted') send({ type: 'execution_interrupted', data: { prompt_id: id } })
    else if (how === 'error') send({ type: 'execution_error', data: { prompt_id: id, exception_message: options.fail } })
    else send({ type: 'executing', data: { node: null, prompt_id: id } })
  }

  const transport: ComfyTransport = {
    async get(path) {
      calls.push(`GET ${path}`)
      const combo = (node: string, input: string, list: unknown) => ({ [node]: { input: { required: { [input]: list } } } })
      if (path === '/system_stats') return { status: 200, body: {} }
      if (path === '/queue') {
        const ids = [...running].map((id, n) => [n, id])
        return { status: 200, body: { queue_running: options.busy ? [[0, 'someone-else']] : ids, queue_pending: [] } }
      }
      if (path === '/object_info/CheckpointLoaderSimple') return { status: 200, body: combo('CheckpointLoaderSimple', 'ckpt_name', [['sdxl/base.safetensors', 'other.safetensors']]) }
      if (path === '/object_info/KSampler') {
        return { status: 200, body: { KSampler: { input: { required: { sampler_name: [['euler', 'dpmpp_2m']], scheduler: [['normal', 'karras']] } } } } }
      }
      // The newer COMBO form of the same answer.
      if (path === '/object_info/LoraLoader') return { status: 200, body: combo('LoraLoader', 'lora_name', ['COMBO', { options: ['styles/Ink.safetensors'] }]) }
      // ComfyUI answers {} for a node it does not have.
      if (path === '/object_info/ControlNetLoader') {
        return { status: 200, body: options.controlnet ? combo('ControlNetLoader', 'control_net_name', [['sdxl/openpose.safetensors']]) : {} }
      }
      if (path === '/object_info/ControlNetApplyAdvanced') return { status: 200, body: options.controlnet ? { ControlNetApplyAdvanced: { input: { required: {} } } } : {} }
      if (path === '/object_info/UpscaleModelLoader') return { status: 200, body: options.upscalers ? combo('UpscaleModelLoader', 'model_name', [options.upscalers]) : {} }
      const match = /^\/history\/(.+)$/.exec(path)
      if (match) {
        const id = decodeURIComponent(match[1])
        return { status: 200, body: history.has(id) ? { [id]: history.get(id) } : {} }
      }
      return { status: 404, body: null }
    },
    async post(path, body) {
      calls.push(`POST ${path} ${JSON.stringify(path === '/prompt' ? {} : body)}`)
      if (path === '/prompt') {
        if (options.refuse) return { status: 400, body: options.refuse }
        const { prompt, client_id } = body as { prompt: (typeof graphs)[number]; client_id: string }
        graphs.push(prompt)
        clients.push(client_id)
        const id = `p${graphs.length}`
        running.add(id)
        if (!state.hold) {
          setTimeout(() => {
            if (options.progress) for (const data of options.progress) send?.({ type: 'progress', data: { ...data, prompt_id: id } })
            else {
              send?.({ type: 'progress', data: { value: 1, max: 2, prompt_id: id } })
              send?.({ type: 'progress', data: { value: 2, max: 2, prompt_id: id } })
            }
            send?.({ type: 'progress', data: { value: 9, max: 9, prompt_id: 'someone-else' } })
            finish(id, options.fail ? 'error' : 'success')
          }, 5)
        }
        return { status: 200, body: { prompt_id: id, number: graphs.length, node_errors: {} } }
      }
      if (path === '/interrupt') {
        const id = (body as { prompt_id: string }).prompt_id
        if (running.has(id)) finish(id, 'interrupted')
      }
      if (path === '/history') {
        for (const id of (body as { delete?: string[] }).delete ?? []) {
          deleted.push(id)
          history.delete(id)
        }
      }
      return { status: 200, body: {} }
    },
    async upload(name, subfolder, png) {
      calls.push(`UPLOAD ${subfolder}/${name}`)
      uploads.push({ name, subfolder, png })
      return { status: 200, body: { name, subfolder, type: 'input' } }
    },
    async getBytes(path, _timeout, maxBytes) {
      calls.push(`GET ${path}`)
      return { status: 200, bytes: png.length <= maxBytes ? png : null }
    },
    async listen(_clientId, onMessage) {
      if (!options.socket) return null
      send = onMessage
      return { close: () => (send = null) }
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 2))),
  }
  /** Lets held prompts (and any queued later) finish. */
  const release = () => {
    state.hold = false
    for (const id of [...running]) finish(id, 'success')
  }
  return { transport, calls, graphs, clients, running, uploads, deleted, release }
}

async function main() {
  // ── The graph ──
  eq(withoutLoraCalls('1girl, <lora:ink:0.7>, smile, <lyco:x>'), '1girl, smile', 'LoRA calls are taken out of the text the encoder reads')
  eq(withoutLoraCalls('<lora:a:1> 1girl'), '1girl', 'also at the start')
  eq(comboOptions({ N: { input: { required: { x: [['a', 'b', 3]] } } } }, 'N', 'x'), ['a', 'b'], 'object_info: the list form')
  eq(comboOptions({ N: { input: { required: { x: ['COMBO', { options: ['c'] }] } } } }, 'N', 'x'), ['c'], 'object_info: the COMBO form')
  eq(comboOptions(null, 'N', 'x'), null, 'object_info: nothing for no answer')
  eq(
    resolveLoras([{ name: 'ink', weight: 0.7 }, { name: 'gone', weight: 1 }], ['styles/Ink.safetensors']),
    { found: [{ file: 'styles/Ink.safetensors', use: { name: 'ink', weight: 0.7 } }], missing: ['gone'] },
    'LoRA calls are matched to files by name, ignoring folder, extension and case'
  )
  const graph = buildComfyGraph(REQUEST, { checkpoint: 'sdxl/base.safetensors', loras: [{ file: 'styles/Ink.safetensors', weight: 0.7 }], seed: 5, sizeMultiple: 8 })
  eq(
    Object.fromEntries(Object.entries(graph).map(([id, node]) => [id, node.class_type])),
    { '1': 'CheckpointLoaderSimple', '10': 'LoraLoader', '2': 'CLIPTextEncode', '3': 'CLIPTextEncode', '4': 'EmptyLatentImage', '5': 'KSampler', '6': 'VAEDecode', '7': 'PreviewImage' },
    'graph: checkpoint, LoRA, two prompts, latent, sampler, decode, and PreviewImage (no file in ComfyUI\'s output folder)'
  )
  eq(graph['10'].inputs, { model: ['1', 0], clip: ['1', 1], lora_name: 'styles/Ink.safetensors', strength_model: 0.7, strength_clip: 0.7 }, 'the LoRA sits between the checkpoint and the rest')
  eq([graph['2'].inputs.text, graph['2'].inputs.clip, graph['3'].inputs.text], ['1girl, smile', ['10', 1], 'lowres'], 'prompts go through the LoRA\'s CLIP')
  eq(graph['4'].inputs, { width: 832, height: 1216, batch_size: 1 }, 'the size is snapped to the profile\'s multiple')
  eq(
    [graph['5'].inputs.seed, graph['5'].inputs.steps, graph['5'].inputs.cfg, graph['5'].inputs.sampler_name, graph['5'].inputs.scheduler, graph['5'].inputs.model],
    [5, 2, 5, 'euler', 'karras', ['10', 0]],
    'the sampler: seed, steps, cfg, "Default" as euler, the scheduler asked for, the LoRA\'s model'
  )

  // ── Status ──
  const quiet = await scriptedComfy()
  const status = await new ComfyUIAdapter(CONFIG, quiet.transport).status()
  eq(
    [status.alive, status.busy, status.model, status.samplers, status.schedulers],
    [true, false, 'base.safetensors', ['Default', 'euler', 'dpmpp_2m'], ['Default', 'normal', 'karras']],
    'status: up, idle, the first checkpoint by file name only, its samplers and schedulers'
  )
  eq(status.capabilities, { img2img: true, inpaint: true, pose: false, lora: true, tag: false, presets: false, preciseCancel: true, hires: true, upscale: true }, 'capabilities: txt2img, img2img and inpaint with LoRAs, hires fix and upscale, cancel of our own prompt')
  eq(status.upscalers, ['Lanczos'], 'without UpscaleModelLoader, hires fix upscales with Lanczos only')
  eq(status.hints, { pose: { reason: 'setup', need: 'engine' } }, 'pose is explained: no engine runs to draw the skeleton')
  const withEngine = await new ComfyUIAdapter({ ...CONFIG, id: 'comfy-engine' }, quiet.transport, () => ({ pose: async () => ({ ok: true as const, value: {} }) })).status()
  eq(withEngine.hints, { pose: { reason: 'setup', need: 'nodes' } }, 'with one, that this ComfyUI has no ControlNet nodes')
  const nothing = { nodes: false, controlnet: false, engine: false }
  eq(comfyHints(false, nothing), {}, 'no hints while it is down')
  eq(
    [
      comfyHints(true, nothing),
      comfyHints(true, { ...nothing, engine: true }),
      comfyHints(true, { nodes: true, controlnet: false, engine: true }),
      comfyHints(true, { nodes: true, controlnet: true, engine: true }),
    ],
    [{ pose: { reason: 'setup', need: 'engine' } }, { pose: { reason: 'setup', need: 'nodes' } }, { pose: { reason: 'setup', need: 'controlnet' } }, {}],
    'the first thing missing, the engine first (a workflow needs only that): then the nodes, a ControlNet chosen; nothing once all are there'
  )
  eq((await new ComfyUIAdapter({ ...CONFIG, id: 'comfy-2', model: 'other.safetensors' }, quiet.transport).status()).model, 'other.safetensors', 'the model set for the backend is the one shown')

  // ── Why it is down ──
  eq(status.problem, undefined, 'no problem while it answers')
  const answering = (stats: () => Promise<{ status: number; body: unknown }>): ComfyTransport => ({
    get: (path) => (path === '/system_stats' ? stats() : Promise.resolve({ status: 404, body: null })),
    post: async () => ({ status: 404, body: null }),
    getBytes: async () => ({ status: 404, bytes: null }),
    upload: async () => ({ status: 404, body: null }),
    listen: async () => null,
    sleep: async () => {},
  })
  const problemOf = async (stats: () => Promise<{ status: number; body: unknown }>) => {
    const down = await new ComfyUIAdapter({ ...CONFIG, id: 'down' }, answering(stats)).status()
    return { alive: down.alive, problem: down.problem }
  }
  eq(
    await problemOf(async () => ({ status: 401, body: { error: 'Authentication required.' } })),
    { alive: false, problem: { reason: 'auth', status: 401, detail: 'Authentication required.' } },
    'a login in front of ComfyUI (a login node, a proxy) is said, with its own words'
  )
  const failing500 = await problemOf(async () => ({ status: 500, body: { error: 'broke at C:\\Users\\someone\\ComfyUI\\x.py\nline 2' } }))
  eq([failing500.problem?.reason, failing500.problem?.status], ['http', 500], 'another error status is said with its code')
  check(!!failing500.problem?.detail && !failing500.problem.detail.includes('someone') && !failing500.problem.detail.includes('\n'), 'its words on one line, without paths')
  eq(await problemOf(async () => Promise.reject(new Error('connect ECONNREFUSED'))), { alive: false, problem: { reason: 'unreachable' } }, 'no answer at all is said as such')

  // ── A run, with the progress socket ──
  const live = await scriptedComfy({ socket: true })
  const started = await new ComfyUIAdapter({ ...CONFIG, id: 'live' }, live.transport).start(REQUEST)
  check(started.ok, 'a run starts')
  const events = started.ok ? await collect(started.value) : []
  eq(
    events.map((event) => (event.type === 'image' ? `image ${event.index} seed ${event.seed}` : event.type === 'step' ? `step ${event.step}` : event.type)),
    ['start', 'step 1', 'step 2', 'image 0 seed 5', 'start', 'step 1', 'step 2', 'image 1 seed 6', 'done'],
    'one prompt per picture, in turn: start, steps from the socket (only its own), image, then done'
  )
  eq(live.graphs.map((queued) => queued['5'].inputs.seed), [5, 6], 'each picture is its own prompt with the next seed')
  check(live.clients.length === 2 && live.clients[0] === live.clients[1], 'under one client id, the socket\'s')
  const image = events.find((event) => event.type === 'image')
  const saved = image?.type === 'image' ? Buffer.from(image.imageBase64, 'base64') : Buffer.alloc(0)
  check(isPng(saved), 'the picture is a PNG')
  eq(Object.keys(readPngText(saved)), ['other'], "ComfyUI's prompt and workflow chunks (which name model folders) are taken out; others stay")
  eq(image?.type === 'image' ? image.loras : undefined, [{ name: 'ink', weight: 0.7 }], 'the image says which LoRAs were applied')
  check(live.calls.some((call) => call.startsWith('GET /view?') && call.includes('type=temp')), 'the picture is read from ComfyUI\'s temp folder')

  // ── Without the socket: /history ──
  const polled = await scriptedComfy()
  const plain = await new ComfyUIAdapter({ ...CONFIG, id: 'polled' }, polled.transport).start({ ...REQUEST, image_count: 1, seed: -1 })
  const plainEvents = plain.ok ? await collect(plain.value) : []
  eq(plainEvents.map((event) => event.type), ['start', 'image', 'done'], 'without the socket the run still ends, from /history')
  const randomSeed = polled.graphs[0]?.['5'].inputs.seed
  check(typeof randomSeed === 'number' && Number.isInteger(randomSeed) && randomSeed >= 0, 'a random seed (-1) is picked here, as a whole number')

  // ── Refusals ──
  const busy = await scriptedComfy({ busy: true })
  const refused = await new ComfyUIAdapter({ ...CONFIG, id: 'busy' }, busy.transport).start(REQUEST)
  check(!refused.ok && refused.status === 409, 'a ComfyUI busy with another client\'s prompt is refused')
  check(!busy.calls.some((call) => call.startsWith('POST /prompt')), 'and nothing is queued')
  const adapter = new ComfyUIAdapter({ ...CONFIG, id: 'refusals' }, quiet.transport)
  const missing = await adapter.start({ ...REQUEST, prompt: 'x <lora:gone:1>' })
  check(!missing.ok && missing.status === 400 && missing.error.includes('gone'), 'a LoRA ComfyUI does not have is refused, by name')
  const unreadable = await adapter.start({ ...REQUEST, init_image_base64: 'iVBORw0KGgo=' })
  check(!unreadable.ok && unreadable.status === 400, 'a source image that cannot be read is refused')
  const maskOnly = await adapter.start({ ...REQUEST, mask_base64: 'iVBORw0KGgo=' })
  check(!maskOnly.ok && maskOnly.status === 400, 'a mask without a source is refused')
  const unknown = await new ComfyUIAdapter({ ...CONFIG, id: 'model', model: 'not-there.safetensors' }, quiet.transport).start(REQUEST)
  check(!unknown.ok && unknown.status === 400 && unknown.error.includes('not-there'), 'a set model that ComfyUI does not list is refused')
  const graphError = await scriptedComfy({
    refuse: { error: { message: 'Prompt outputs failed validation' }, node_errors: { '5': { errors: [{ message: 'Value not in list', details: "sampler_name: 'x' not in C:\\Users\\someone\\ComfyUI\\list" }] } } },
  })
  const failing = await new ComfyUIAdapter({ ...CONFIG, id: 'invalid' }, graphError.transport).start(REQUEST)
  const failed = failing.ok ? (await collect(failing.value)).at(-1) : null
  check(
    failed?.type === 'error' && failed.message.includes('Prompt outputs failed validation') && failed.message.includes("sampler_name: 'x' not in"),
    "a graph ComfyUI refuses ends the run in error, with its message and the node's details"
  )
  check(failed?.type === 'error' && !failed.message.includes('someone'), 'with paths in its details taken out')
  const crashing = await scriptedComfy({ socket: true, fail: 'CUDA out of memory at C:\\Users\\someone\\x.py' })
  const crash = await new ComfyUIAdapter({ ...CONFIG, id: 'crash' }, crashing.transport).start({ ...REQUEST, image_count: 1 })
  const crashed = crash.ok ? (await collect(crash.value)).at(-1) : null
  check(crashed?.type === 'error' && crashed.message.includes('CUDA out of memory') && !crashed.message.includes('someone'), 'an error while running ends the run, paths taken out')

  // ── img2img and inpaint ──
  const i2iGraph = buildComfyGraph(REQUEST, {
    checkpoint: 'c.safetensors',
    loras: [],
    seed: 1,
    sizeMultiple: 8,
    images: { source: 'latentry/x-source.png', mask: 'latentry/x-mask.png', strength: 0.4 },
  })
  eq(
    [i2iGraph['8']?.inputs, i2iGraph['9']?.inputs, i2iGraph['30']?.inputs, i2iGraph['31']?.inputs],
    [
      { image: 'latentry/x-source.png' },
      { pixels: ['8', 0], vae: ['1', 2] },
      { image: 'latentry/x-mask.png', channel: 'red' },
      { samples: ['9', 0], mask: ['30', 0] },
    ],
    'inpaint graph: the source is loaded and encoded by the checkpoint\'s VAE, the mask (white = redraw) set on its latent'
  )
  eq([i2iGraph['5'].inputs.latent_image, i2iGraph['5'].inputs.denoise, '4' in i2iGraph], [['31', 0], 0.4, false], 'the sampler starts from it, with denoise as strength, and no empty latent')
  const plainI2i = buildComfyGraph(REQUEST, { checkpoint: 'c', loras: [], seed: 1, sizeMultiple: 8, images: { source: 's.png', strength: 0.6 } })
  eq([plainI2i['5'].inputs.latent_image, '30' in plainI2i], [['9', 0], false], 'img2img without a mask: the encoded source as it is')

  const sourcePng = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#468' } }).png().toBuffer()
  // Opaque (redraw) on the left half, transparent on the right.
  const maskPng = await sharp({ create: { width: 300, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: { create: { width: 150, height: 200, channels: 4, background: { r: 255, g: 0, b: 255, alpha: 1 } } }, left: 0, top: 0 }])
    .png()
    .toBuffer()
  const painter = await scriptedComfy({ socket: true })
  const inpaint = await new ComfyUIAdapter({ ...CONFIG, id: 'painter' }, painter.transport).start({
    ...REQUEST,
    image_count: 1,
    init_image_base64: sourcePng.toString('base64'),
    mask_base64: maskPng.toString('base64'),
    mask_blur: 0,
    strength: 0.5,
  })
  check(inpaint.ok, 'an inpaint run starts')
  const inpaintEvents = inpaint.ok ? await collect(inpaint.value) : []
  eq(inpaintEvents.map((event) => event.type), ['start', 'step', 'step', 'image', 'done'], 'and ends with its picture')
  eq(painter.uploads.map(({ subfolder, name }) => `${subfolder}/${name}`), ['latentry/painter-source.png', 'latentry/painter-mask.png'], 'the source and mask go up under two fixed names for this backend')
  const fitted = fitToImage({ width: 300, height: 200 }, REQUEST.width, REQUEST.height, 8)
  const upSource = await sharp(painter.uploads[0].png).metadata()
  eq([upSource.width, upSource.height], [fitted.width, fitted.height], 'the source is sent at the size fitted to its aspect')
  eq([painter.graphs[0]['8'].inputs.image, painter.graphs[0]['30'].inputs.image, painter.graphs[0]['5'].inputs.denoise], ['latentry/painter-source.png', 'latentry/painter-mask.png', 0.5], 'the graph loads what went up, at the strength asked for')
  const maskPixels = await sharp(painter.uploads[1].png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const at = (x: number) => maskPixels.data[(Math.floor(maskPixels.info.height / 2) * maskPixels.info.width + x) * maskPixels.info.channels]
  eq([at(10), at(maskPixels.info.width - 10)], [255, 0], 'the mask goes up white where the page painted, black elsewhere')
  eq(painter.deleted, [], 'an ordinary run leaves its history on ComfyUI')
  eq(painter.uploads.length, 2, 'and its uploads as they are')

  // ── Pose: the engine draws, ComfyUI follows ──
  const poseGraph = buildComfyGraph(REQUEST, {
    checkpoint: 'c',
    loras: [],
    seed: 1,
    sizeMultiple: 8,
    pose: { image: 'latentry/x-pose.png', controlnet: 'sdxl/openpose.safetensors', strength: 0.8 },
  })
  eq(
    [poseGraph['32']?.inputs, poseGraph['33']?.inputs, poseGraph['34']?.class_type, poseGraph['34']?.inputs],
    [
      { image: 'latentry/x-pose.png' },
      { control_net_name: 'sdxl/openpose.safetensors' },
      'ControlNetApplyAdvanced',
      { positive: ['2', 0], negative: ['3', 0], control_net: ['33', 0], image: ['32', 0], strength: 0.8, start_percent: 0, end_percent: 1, vae: ['1', 2] },
    ],
    'pose graph: the skeleton and the ControlNet go into ControlNetApplyAdvanced with both prompts, at the strength asked for'
  )
  eq([poseGraph['5'].inputs.positive, poseGraph['5'].inputs.negative, poseGraph['5'].inputs.latent_image], [['34', 0], ['34', 1], ['4', 0]], 'the sampler takes its conditioning from it, the latent as before')
  eq([graph['5'].inputs.positive, graph['5'].inputs.negative, '34' in graph], [['2', 0], ['3', 0], false], 'without a pose, no ControlNet at all')
  const poseInpaint = buildComfyGraph(REQUEST, {
    checkpoint: 'c',
    loras: [],
    seed: 1,
    sizeMultiple: 8,
    images: { source: 's.png', mask: 'm.png', strength: 0.5 },
    pose: { image: 'p.png', controlnet: 'cn', strength: 1 },
  })
  eq([poseInpaint['5'].inputs.latent_image, poseInpaint['5'].inputs.positive], [['31', 0], ['34', 0]], 'a pose with inpaint: the masked latent, followed by the skeleton')

  // ── Hires fix ──
  const HIRES: GenerateRequest = { ...REQUEST, hr_scale: 1.5, hr_steps: 3, hr_denoise: 0.35, hr_upscaler: 'Lanczos' }
  const lanczos = buildComfyGraph(HIRES, { checkpoint: 'c', loras: [], seed: 7, sizeMultiple: 8 })
  eq(
    ['40', '41', '42', '43', '44', '45', '6'].map((id) => lanczos[id]?.class_type ?? null),
    ['VAEDecode', 'ImageScale', 'VAEEncode', 'KSampler', null, null, 'VAEDecode'],
    'hires fix with Lanczos: decode, scale, encode, sample again, then the decode that is saved'
  )
  eq(lanczos['41'].inputs, { image: ['40', 0], upscale_method: 'lanczos', width: 1248, height: 1824, crop: 'disabled' }, 'scaled to the first size (snapped) times the scale, on the profile\'s multiple')
  eq(
    [lanczos['43'].inputs.seed, lanczos['43'].inputs.steps, lanczos['43'].inputs.denoise, lanczos['43'].inputs.latent_image, lanczos['43'].inputs.positive, lanczos['6'].inputs.samples],
    [7, 3, 0.35, ['42', 0], ['2', 0], ['43', 0]],
    'the second pass: same seed and prompts, its own steps at the hires denoise'
  )
  eq(buildComfyGraph({ ...HIRES, hr_steps: 0 }, { checkpoint: 'c', loras: [], seed: 7, sizeMultiple: 8 })['43'].inputs.steps, 2, '0 hires steps runs as many as the first pass')
  const modelled = buildComfyGraph(HIRES, { checkpoint: 'c', loras: [], seed: 7, sizeMultiple: 8, upscaleModel: 'sr/RealESRGAN_x4plus.pth' })
  eq(
    [modelled['44'].inputs, modelled['45'].inputs, modelled['41'].inputs.image],
    [{ model_name: 'sr/RealESRGAN_x4plus.pth' }, { upscale_model: ['44', 0], image: ['40', 0] }, ['45', 0]],
    'with an upscale model: its upscale first, then Lanczos to the exact size'
  )
  const posedHires = buildComfyGraph(HIRES, { checkpoint: 'c', loras: [], seed: 7, sizeMultiple: 8, pose: { image: 'p.png', controlnet: 'cn', strength: 1 } })
  eq([posedHires['43'].inputs.positive, posedHires['43'].inputs.negative], [['34', 0], ['34', 1]], 'with a pose, the second pass follows the skeleton too')
  eq('43' in buildComfyGraph(HIRES, { checkpoint: 'c', loras: [], seed: 7, sizeMultiple: 8, images: { source: 's.png', strength: 0.6 } }), false, 'never on img2img')
  eq(
    [upscalerNames(['sr/4x.pth', 'b.safetensors', 'other/4x.pth']), resolveUpscaler('4x.pth', ['sr/4x.pth']), resolveUpscaler('Lanczos', ['sr/4x.pth']), resolveUpscaler('gone.pth', [])],
    [['Lanczos', '4x.pth', 'b.safetensors'], 'sr/4x.pth', null, undefined],
    'upscalers listed by file name, each once, and found again by it'
  )

  const upscaling = await scriptedComfy({
    socket: true,
    upscalers: ['sr/RealESRGAN_x4plus.pth'],
    progress: [
      { node: '5', value: 1, max: 2 },
      { node: '5', value: 2, max: 2 },
      { node: '45', value: 1, max: 9 },
      { node: '43', value: 1, max: 3 },
      { node: '43', value: 3, max: 3 },
    ],
  })
  const hiresAdapter = new ComfyUIAdapter({ ...CONFIG, id: 'hires' }, upscaling.transport)
  eq((await hiresAdapter.status()).upscalers, ['Lanczos', 'RealESRGAN_x4plus.pth'], 'its upscale models by file name: the folders stay here')
  const hiresRun = await hiresAdapter.start({ ...HIRES, image_count: 1, hr_upscaler: 'RealESRGAN_x4plus.pth' })
  const hiresEvents = hiresRun.ok ? await collect(hiresRun.value) : []
  eq(
    hiresEvents.map((event) => (event.type === 'start' ? `start ${event.steps}` : event.type === 'step' ? `step ${event.step}` : event.type)),
    ['start 5', 'step 1', 'step 2', 'step 3', 'step 5', 'image', 'done'],
    'one bar of 2 + 3 steps: the second sampler after the first, the upscale model\'s tiles not counted'
  )
  eq(upscaling.graphs[0]['44']?.inputs.model_name, 'sr/RealESRGAN_x4plus.pth', 'the file is found again by its name')
  const noUpscaler = await hiresAdapter.start({ ...HIRES, hr_upscaler: 'gone.pth' })
  eq(noUpscaler.ok ? null : [noUpscaler.status, noUpscaler.error], [400, 'Upscaler not found on this backend: gone.pth'], 'an upscaler it does not have is refused')

  // ── Upscale a source ──
  const UPSCALE: GenerateRequest = { ...REQUEST, image_count: 1, upscale: true, hr_scale: 2, hr_steps: 6, hr_denoise: 0.3, hr_upscaler: 'Lanczos' }
  const upGraph = buildComfyGraph(UPSCALE, { checkpoint: 'c', loras: [], seed: 4, sizeMultiple: 8, images: { source: 'latentry/s.png', strength: 0.6, size: { width: 400, height: 600 } } })
  eq(
    ['8', '9', '40', '41', '42', '43', '5', '6'].map((id) => upGraph[id]?.class_type ?? null),
    ['LoadImage', null, null, 'ImageScale', 'VAEEncode', null, 'KSampler', 'VAEDecode'],
    'upscale: the source, scaled and encoded, sampled once; no first pass'
  )
  eq(
    [upGraph['41'].inputs.image, upGraph['41'].inputs.width, upGraph['41'].inputs.height, upGraph['5'].inputs.latent_image, upGraph['5'].inputs.denoise, upGraph['5'].inputs.steps],
    [['8', 0], 800, 1200, ['42', 0], 0.3, 6],
    'to the source size times the scale, redrawn at the hires denoise for the hires steps'
  )
  const upModelled = buildComfyGraph(UPSCALE, { checkpoint: 'c', loras: [], seed: 4, sizeMultiple: 8, upscaleModel: 'sr/4x.pth', images: { source: 's.png', strength: 0.6, size: { width: 400, height: 600 } } })
  eq([upModelled['45'].inputs.image, upModelled['41'].inputs.image], [['8', 0], ['45', 0]], 'with an upscale model, it enlarges the source first')

  const upscaler = await scriptedComfy({
    socket: true,
    upscalers: ['sr/RealESRGAN_x4plus.pth'],
    progress: [
      { node: '45', value: 1, max: 4 },
      { node: '5', value: 3, max: 6 },
      { node: '5', value: 6, max: 6 },
    ],
  })
  const smallSource = await sharp({ create: { width: 400, height: 600, channels: 3, background: '#456' } }).png().toBuffer()
  const upRun = await new ComfyUIAdapter({ ...CONFIG, id: 'upscaler' }, upscaler.transport).start({
    ...UPSCALE,
    hr_upscaler: 'RealESRGAN_x4plus.pth',
    init_image_base64: smallSource.toString('base64'),
  })
  const upEvents = upRun.ok ? await collect(upRun.value) : []
  eq(
    upEvents.map((event) => (event.type === 'start' ? `start ${event.steps}` : event.type === 'step' ? `step ${event.step}` : event.type)),
    ['start 6', 'step 3', 'step 6', 'image', 'done'],
    'upscale: one bar of the hires steps; the upscale model\'s tiles not counted'
  )
  const uploadedSource = await sharp(upscaler.uploads[0]?.png ?? Buffer.alloc(0)).metadata().catch(() => null)
  eq([uploadedSource?.width, uploadedSource?.height], [400, 600], 'the source goes up at its own size: ComfyUI enlarges it')
  eq([upscaler.graphs[0]['44']?.inputs.model_name, upscaler.graphs[0]['41']?.inputs.width], ['sr/RealESRGAN_x4plus.pth', 800], 'with the model found by its name, to twice the size')

  const asked: unknown[] = []
  const engine = { pose: async (request: unknown) => (asked.push(request), { ok: true as const, value: { people: [] } }) }
  const POSED: BackendConfig = { ...CONFIG, controlnet: 'sdxl/openpose.safetensors' }
  const poser = await scriptedComfy({ socket: true, controlnet: true })
  const posed = await new ComfyUIAdapter({ ...POSED, id: 'poser' }, poser.transport, () => engine).status()
  eq([posed.capabilities.pose, posed.hints], [true, {}], 'pose is on with the nodes, a ControlNet set and a running engine')
  const noEngine = await new ComfyUIAdapter({ ...POSED, id: 'poser' }, poser.transport, () => null)
  eq([(await noEngine.status()).capabilities.pose, (await noEngine.status()).hints], [false, { pose: { reason: 'setup', need: 'engine' } }], 'off without an engine, and said why')
  eq((await new ComfyUIAdapter({ ...CONFIG, id: 'poser' }, poser.transport, () => engine).status()).hints, { pose: { reason: 'setup', need: 'controlnet' } }, 'off without a ControlNet chosen')

  const detected = await new ComfyUIAdapter({ ...POSED, id: 'poser' }, poser.transport, () => engine).pose({ image_base64: 'abc', person: [0, 2] })
  eq([detected.ok, asked], [true, [{ image_base64: 'abc', person: [0, 2], style: 'openpose' }]], '/pose goes to the engine, asking for OpenPose drawing; nothing to ComfyUI')
  eq(poser.calls.filter((call) => call.startsWith('UPLOAD') || call.startsWith('POST')), [], 'ComfyUI never sees the reference picture')
  const noReader = await noEngine.pose({ image_base64: 'abc' })
  eq(noReader.ok ? null : [noReader.status, noReader.error], [503, 'Start the built-in engine to read poses'], 'no engine: /pose says to start it')

  const skeletonPng = await sharp({ create: { width: 64, height: 96, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer()
  const POSE_RUN: GenerateRequest = { ...REQUEST, image_count: 1, pose_image_base64: skeletonPng.toString('base64'), pose_is_skeleton: true, pose_strength: 0.7 }
  const poseRun = await new ComfyUIAdapter({ ...POSED, id: 'poser' }, poser.transport, () => engine).start(POSE_RUN)
  check(poseRun.ok, 'a pose run starts')
  const poseEvents = poseRun.ok ? await collect(poseRun.value) : []
  eq(poseEvents.map((event) => event.type), ['start', 'step', 'step', 'image', 'done'], 'and ends with its picture')
  eq(poser.uploads.map(({ subfolder, name }) => `${subfolder}/${name}`), ['latentry/poser-pose.png'], 'only the skeleton goes up, under a fixed name for this backend')
  const upSkeleton = await sharp(poser.uploads[0].png).metadata()
  eq([upSkeleton.width, upSkeleton.height, upSkeleton.channels], [832, 1216, 3], 'at the size the latent is drawn at, without alpha')
  eq(
    [poser.graphs[0]['32'].inputs.image, poser.graphs[0]['33'].inputs.control_net_name, poser.graphs[0]['34'].inputs.strength],
    ['latentry/poser-pose.png', 'sdxl/openpose.safetensors', 0.7],
    'the graph loads it, with the ControlNet set for the backend and the pose strength'
  )

  const refusePose = async (config: BackendConfig, request: GenerateRequest, comfy = poser) => {
    const outcome = await new ComfyUIAdapter(config, comfy.transport, () => engine).start(request)
    return outcome.ok ? 'started' : `${outcome.status} ${outcome.error}`
  }
  eq(await refusePose({ ...CONFIG, id: 'poser' }, POSE_RUN), "400 Choose a Pose ControlNet for this backend in Settings", 'a pose without a ControlNet set is refused')
  eq(
    await refusePose({ ...CONFIG, id: 'poser', controlnet: 'gone.safetensors' }, POSE_RUN),
    "400 The Pose ControlNet set for this backend is not in ComfyUI's list: gone.safetensors",
    'so is one ComfyUI does not list'
  )
  eq(await refusePose({ ...POSED, id: 'bare' }, POSE_RUN, quiet), '400 This ComfyUI has no ControlNetLoader and ControlNetApplyAdvanced', 'and a ComfyUI without the nodes')
  eq(
    await refusePose({ ...POSED, id: 'poser' }, { ...POSE_RUN, pose_is_skeleton: false }),
    '400 This backend follows a drawn skeleton only (pose_is_skeleton, from /pose)',
    'a raw reference picture is refused, so it never goes to ComfyUI'
  )
  eq(poser.uploads.length, 1, 'nothing goes up for a refused run')

  // ── Pose in your own workflow: a LoadImage marked latentry:pose ──
  const flowDir = mkdtempSync(path.join(tmpdir(), 'latentry-comfy-pose-'))
  const flow = (extra: Record<string, unknown>) => ({
    '1': { class_type: 'UNETLoader', inputs: { unet_name: 'anima.safetensors' } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: 'old', clip: ['9', 0] } },
    '3': { class_type: 'CLIPTextEncode', inputs: { text: 'old negative', clip: ['9', 0] } },
    '4': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
    '5': { class_type: 'KSampler', inputs: { seed: 1, steps: 20, cfg: 4, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0] } },
    '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['8', 0] } },
    '7': { class_type: 'SaveImage', inputs: { filename_prefix: 'x', images: ['6', 0] } },
    ...extra,
  })
  writeFileSync(
    path.join(flowDir, 'anima-pose.json'),
    JSON.stringify(
      flow({
        '20': { class_type: 'LoadImage', inputs: { image: 'example.png' }, _meta: { title: 'Skeleton latentry:pose' } },
        '21': { class_type: 'AnimaPoseApply', inputs: { strength: 1, image: ['20', 0], model: ['1', 0] }, _meta: { title: 'latentry:pose_strength' } },
      })
    )
  )
  writeFileSync(path.join(flowDir, 'sdxl-pose.json'), JSON.stringify(flow({ '20': { class_type: 'LoadImage', inputs: { image: 'x.png' }, _meta: { title: 'latentry:pose openpose' } } })))
  writeFileSync(path.join(flowDir, 'plain.json'), JSON.stringify(flow({})))
  const FLOWS: BackendConfig = { ...CONFIG, workflowsDir: flowDir }
  try {
    asked.length = 0
    const flowed = new ComfyUIAdapter({ ...FLOWS, id: 'flows' }, quiet.transport, () => engine)
    await flowed.pose({ image_base64: 'abc' }, { workflow: 'anima-pose' })
    await flowed.pose({ image_base64: 'abc' }, { workflow: 'sdxl-pose' })
    eq(
      asked.map((request) => (request as { style?: string }).style),
      ['dwpose', 'openpose'],
      "/pose for a workflow draws the way its latentry:pose node asks: dwpose (Anima's), or openpose when its title says so"
    )
    const unmarked = await flowed.pose({ image_base64: 'abc' }, { workflow: 'plain' })
    eq(unmarked.ok ? null : [unmarked.status, unmarked.error], [400, 'This workflow cannot follow a skeleton: mark its pose LoadImage latentry:pose'], 'a workflow without the marker is refused, saying how to mark it')
    eq(asked.length, 2, 'and nothing went to the engine for it')

    // No ControlNet set and no ControlNet nodes: a workflow brings its own pose nodes.
    const flowComfy = await scriptedComfy({ socket: true })
    const flowRun = await new ComfyUIAdapter({ ...FLOWS, id: 'flows' }, flowComfy.transport, () => engine).start({ ...POSE_RUN, prompt: '1girl, smile', workflow: 'anima-pose' })
    check(flowRun.ok, 'a pose run on a marked workflow starts, without the built-in graph\'s ControlNet')
    if (flowRun.ok) await collect(flowRun.value)
    eq(flowComfy.uploads.map(({ subfolder, name }) => `${subfolder}/${name}`), ['latentry/flows-pose.png'], 'only the skeleton goes up, under the same fixed name')
    eq(
      [flowComfy.graphs[0]?.['20']?.inputs.image, flowComfy.graphs[0]?.['21']?.inputs.strength, flowComfy.graphs[0]?.['7']?.class_type],
      ['latentry/flows-pose.png', 0.7, 'PreviewImage'],
      'the marked LoadImage loads it, the latentry:pose_strength node takes the pose strength, the rest is filled as always'
    )
    const plainRun = await new ComfyUIAdapter({ ...FLOWS, id: 'flows-plain' }, flowComfy.transport, () => engine).start({ ...POSE_RUN, prompt: '1girl, smile', workflow: 'plain' })
    eq(plainRun.ok ? 'started' : `${plainRun.status} ${plainRun.error}`, '400 This workflow cannot follow a skeleton: mark its pose LoadImage latentry:pose', 'a pose run on an unmarked workflow is refused')
    eq(flowComfy.uploads.length, 1, 'before anything goes up')
  } finally {
    rmSync(flowDir, { recursive: true, force: true })
  }

  const hiddenPose = await scriptedComfy({ socket: true, controlnet: true })
  const secretPose = await new ComfyUIAdapter({ ...POSED, id: 'hidden-pose' }, hiddenPose.transport, () => engine).start({
    ...POSE_RUN,
    init_image_base64: sourcePng.toString('base64'),
    secret: true,
  })
  if (secretPose.ok) await collect(secretPose.value)
  eq(hiddenPose.uploads.map(({ name }) => name), ['hidden-pose-source.png', 'hidden-pose-pose.png', 'hidden-pose-source.png', 'hidden-pose-pose.png'], 'a secret pose run blanks the skeleton as well as the source')
  eq(hiddenPose.deleted, ['p1'], 'and deletes its prompt from the history')

  const stored = (kind: 'comfyui' | 'a1111', controlnet: unknown) => {
    const checked = validateSettings({ backends: [{ id: 'c', kind, url: 'http://c:1', profile: 'sdxl', controlnet }] }, { version: 1 }, {})
    return checked.ok ? checked.settings.backends?.[0].controlnet : checked.errors
  }
  eq(
    [stored('comfyui', ' sdxl/openpose.safetensors '), stored('comfyui', ''), stored('a1111', 'x.safetensors')],
    ['sdxl/openpose.safetensors', undefined, undefined],
    'settings keep a comfyui backend\'s ControlNet, trimmed; blank is none, and other kinds keep none'
  )
  eq(
    [stored('comfyui', 'two\nlines'), stored('comfyui', 'x'.repeat(513)), stored('comfyui', 5)],
    Array(3).fill({ 'backends.0.controlnet': 'settings.errorBackendModel' }),
    'one line, at most 512 characters, and text'
  )

  // ── Secret runs take back their traces ──
  const hidden = await scriptedComfy({ socket: true })
  const secretRun = await new ComfyUIAdapter({ ...CONFIG, id: 'hidden' }, hidden.transport).start({ ...REQUEST, init_image_base64: sourcePng.toString('base64'), secret: true })
  if (secretRun.ok) await collect(secretRun.value)
  eq(hidden.deleted, ['p1', 'p2'], 'a secret run deletes both its prompts from ComfyUI\'s history')
  const blanks = hidden.uploads.slice(1)
  eq(blanks.map(({ name }) => name), ['hidden-source.png'], 'and overwrites its upload')
  const blankMeta = blanks[0] ? await sharp(blanks[0].png).metadata() : null
  eq([blankMeta?.width, blankMeta?.height], [1, 1], 'with an empty 1×1 picture')

  const midway = await scriptedComfy({ socket: true, hold: true })
  const midAdapter = new ComfyUIAdapter({ ...CONFIG, id: 'midway' }, midway.transport)
  const midRun = await midAdapter.start(REQUEST)
  const midSeen: BackendEvent[] = []
  const midDone = midRun.ok
    ? (async () => {
        for await (const event of midRun.value) midSeen.push(event)
      })()
    : Promise.resolve()
  while (!midSeen.some((event) => event.type === 'start')) await new Promise((resolve) => setTimeout(resolve, 2))
  await midAdapter.markSecret()
  midway.release()
  await midDone
  eq(midSeen.at(-1)?.type, 'done', 'a run marked secret midway still finishes')
  eq(midway.deleted, ['p1', 'p2'], 'and then deletes every prompt it queued, the one before the mark too')

  const late = await scriptedComfy({ socket: true })
  const lateAdapter = new ComfyUIAdapter({ ...CONFIG, id: 'late' }, late.transport)
  const lateRun = await lateAdapter.start({ ...REQUEST, image_count: 1 })
  if (lateRun.ok) await collect(lateRun.value)
  eq(late.deleted, [], 'an ordinary run, just ended, has not been wiped')
  await lateAdapter.markSecret()
  eq(late.deleted, ['p1'], 'marked secret within the grace, it is wiped at once')
  await lateAdapter.markSecret()
  eq(late.deleted, ['p1'], 'and only once')
  const stale = await scriptedComfy({ socket: true })
  const staleAdapter = new ComfyUIAdapter({ ...CONFIG, id: 'stale' }, stale.transport)
  const staleRun = await staleAdapter.start({ ...REQUEST, image_count: 1 })
  if (staleRun.ok) await collect(staleRun.value)
  const realNow = Date.now
  Date.now = () => realNow() + SECRET_GRACE_MS + 1000
  try {
    await staleAdapter.markSecret()
  } finally {
    Date.now = realNow
  }
  eq(stale.deleted, [], 'past the grace there is nothing left to mark')

  // ── The job store's side of a mark ──
  const marked = startJob({ backend: 'mark-test', total: 1, steps: 1, context: { request: {} as never, profile: 'generic', kind: 'comfyui', model: null, mode: 'txt2img' } })
  check(isResumable(marked), 'an ordinary run can be picked up after a reload')
  markSecret(marked)
  check(!isResumable(marked) && marked.secret, 'marked secret, it no longer can')
  eq(keptFor(marked), SECRET_GRACE_MS, 'and is kept only for the secret grace once it ends')
  markSecret(marked)
  check(marked.secret, 'marking twice changes nothing, and nothing makes it ordinary again')

  // ── Cancel: only our own prompt ──
  const held = await scriptedComfy({ socket: true, hold: true })
  const holding = new ComfyUIAdapter({ ...CONFIG, id: 'held' }, held.transport)
  const run = await holding.start(REQUEST)
  const seen: BackendEvent[] = []
  const finished = run.ok
    ? (async () => {
        for await (const event of run.value) seen.push(event)
      })()
    : Promise.resolve()
  while (!seen.some((event) => event.type === 'start')) await new Promise((resolve) => setTimeout(resolve, 2))
  const runId = (seen[0] as { runId?: string }).runId ?? null
  const other = await holding.cancel('someone-else')
  check(!other.ok && other.status === 409, "a cancel naming another run is refused")
  check(!held.calls.some((call) => call.startsWith('POST /interrupt')), 'and nothing is interrupted')
  const own = await holding.cancel(runId)
  check(own.ok, 'the run itself may be cancelled')
  check(held.calls.some((call) => call === `POST /interrupt {"prompt_id":"${runId}"}`), 'by interrupting its own prompt id only')
  await finished
  eq(seen.map((event) => event.type), ['start', 'cancelled'], 'the run ends cancelled')
  eq(held.graphs.length, 1, 'and the second picture is never queued')
  check((await holding.cancel(null)).ok, 'a cancel after the run is a no-op')

  // ── Redirects are refused, not followed ──
  const elsewhere = await listen(() => 200)
  const redirecting = await listen(() => [307, `${elsewhere.url}/stolen`])
  const redirected = new ComfyUIAdapter({ ...CONFIG, id: 'redirect', url: redirecting.url, token: 'secret' })
  const redirectedStatus = await redirected.status()
  check(!redirectedStatus.alive, 'a redirected ComfyUI is not alive')
  eq(redirectedStatus.problem, { reason: 'redirect' }, 'and the page is told it redirected')
  const locked = await listen(() => 401)
  eq((await new ComfyUIAdapter({ ...CONFIG, id: 'locked', url: locked.url }).status()).problem, { reason: 'auth', status: 401 }, 'a real 401 over HTTP reads as a login')
  locked.server.close()
  const tried = await redirected.start(REQUEST)
  check(!tried.ok && tried.status === 502, 'and a run on it is refused')
  eq(elsewhere.hits, [], 'nothing reached the address the redirect pointed at')
  elsewhere.server.close()
  redirecting.server.close()
  check(REDIRECT_REFUSED.length > 0, 'the redirect message exists')

  await throughRoutes()

  done('comfyui')
}

/** A whole run through the API routes, against the mock ComfyUI, saved to a temp gallery. */
async function throughRoutes(): Promise<void> {
  const scratch = mkdtempSync(path.join(tmpdir(), 'latentry-comfyui-'))
  const saveDir = path.join(scratch, 'out')
  const mock = await startMockComfyUI()
  writeFileSync(
    path.join(scratch, 'settings.json'),
    JSON.stringify({ version: 1, backends: [{ id: 'comfy', kind: 'comfyui', url: mock.url, profile: 'sdxl' }], gallery: { saveDir, dirs: [] }, engine: { autoStart: false } })
  )
  Object.assign(process.env, { LATENTRY_SETTINGS_FILE: path.join(scratch, 'settings.json'), LATENTRY_RUNTIME_DIR: path.join(scratch, 'runtime'), LATENTRY_ENGINE: 'off' })
  for (const name of ['GEN_BACKENDS', 'DIFFUSION_SERVER_URL', 'GALLERY_SAVE_DIR', 'GALLERY_DIRS', 'GALLERY_AUTO_TAG']) delete process.env[name]
  const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) }) as never
  // Imported here, after the environment is set.
  const { GET: backendsRoute } = await import('../app/api/gen/backends/route')
  const { POST: generateRoute } = await import('../app/api/gen/[backend]/generate/route')
  const { getJob } = await import('../lib/diffusion/job-store')

  try {
    const listed = (await (await backendsRoute()).json()) as { backends: { id: string; kind: string; alive: boolean; model: string | null }[] }
    eq(listed.backends.map(({ id, kind, alive, model }) => ({ id, kind, alive, model })), [{ id: 'comfy', kind: 'comfyui', alive: true, model: 'base.safetensors' }], 'the page sees the ComfyUI backend, its model by file name only')
    check(!JSON.stringify(listed).includes('private-folder'), 'and none of the folders the model sits in')

    const { POST: testRoute } = await import('../app/api/settings/test/route')
    const tryBackend = (host: string) =>
      testRoute(
        new Request(`http://${host}/api/settings/test`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', host },
          body: JSON.stringify({ kind: 'comfyui', url: mock.url, controlnet: 'private-folder/openpose.safetensors' }),
        })
      )
    const tried = (await (await tryBackend('127.0.0.1:3000')).json()) as { controlnets?: string[]; capabilities?: { pose?: boolean }; hints?: unknown }
    eq(tried.controlnets, ['private-folder/openpose.safetensors'], 'Settings Test lists ComfyUI\'s ControlNets, folders included, on this machine')
    eq([tried.capabilities?.pose, tried.hints], [false, { pose: { reason: 'setup', need: 'engine' } }], 'and says pose waits for a running engine')
    eq((await tryBackend('192.168.1.20:3000')).status, 403, 'a paired device cannot ask for that list')

    const started = await generateRoute(
      new Request('http://127.0.0.1:3000/api/gen/comfy/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'a lighthouse, <lora:ink:0.5>', width: 512, height: 768, num_inference_steps: 4, seed: 11 }),
      }),
      params({ backend: 'comfy' })
    )
    eq(started.status, 200, 'a run starts through the route')
    const jobId = ((await started.json()) as { job?: { id?: string } }).job?.id ?? ''
    const end = Date.now() + 15_000
    while (Date.now() < end) {
      const job = getJob('comfy', jobId)
      if (job && job.status !== 'running' && job.pendingSaves === 0) break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    const job = getJob('comfy', jobId)
    eq([job?.status, job?.error ?? null], ['done', null], 'and ends done')
    const queued = mock.graphs[0]
    eq([queued?.['2']?.inputs.text, queued?.['10']?.inputs.lora_name, queued?.['5']?.inputs.seed], ['a lighthouse', 'styles/ink.safetensors', 11], 'ComfyUI got the graph built here: prompt, LoRA file, seed')
    const name = job?.images[0]?.saved_name ?? ''
    eq(readdirSync(saveDir), [name], 'the picture is in the save folder')
    const text = readPngText(readFileSync(path.join(saveDir, name)))
    check(!('prompt' in text) && !('workflow' in text), "the saved picture carries no ComfyUI graph")
    check(!JSON.stringify(text).includes('private-folder'), 'nor the folders of the model')
    const record = JSON.parse(text.latentry ?? '{}') as { kind?: string; model?: string; loras?: { name: string }[] }
    eq([record.kind, record.model, record.loras?.map((lora) => lora.name)], ['comfyui', 'base.safetensors', ['ink']], "Latentry's record: kind, model by file name, the LoRA applied")
    eq(mock.deleted, [], 'an ordinary run leaves ComfyUI\'s history alone')

    const generate = async (body: Record<string, unknown>) => {
      const response = await generateRoute(
        new Request('http://127.0.0.1:3000/api/gen/comfy/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
        params({ backend: 'comfy' })
      )
      return ((await response.json()) as { job?: { id?: string } }).job?.id ?? ''
    }
    const settled = async (id: string) => {
      const end = Date.now() + 15_000
      while (Date.now() < end) {
        const job = getJob('comfy', id)
        if (job && job.status !== 'running' && job.pendingSaves === 0) return job
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      return getJob('comfy', id)
    }

    // img2img in secret mode: the source goes up, and is taken back with the history.
    const source = (await sharp({ create: { width: 96, height: 64, channels: 3, background: '#357' } }).png().toBuffer()).toString('base64')
    const secretJob = await settled(await generate({ prompt: 'a harbour', init_image_base64: source, strength: 0.5, secret: true }))
    eq([secretJob?.status, secretJob?.secret], ['done', true], 'a secret img2img run ends done')
    // The wipe runs once the run has ended (after "done"): history first, then
    // the blank upload, so waiting for that upload waits for both.
    for (const end = Date.now() + 5_000; mock.uploads.length < 2 && Date.now() < end; ) await new Promise((resolve) => setTimeout(resolve, 20))
    eq(mock.uploads, ['comfy-source.png', 'comfy-source.png'], 'its source went up, then was overwritten')
    eq(mock.deleted, ['mock-2'], 'and its prompt was deleted from ComfyUI\'s history')
    eq(mock.graphs[1]?.['8']?.inputs.image, 'latentry/comfy-source.png', 'the graph loaded the uploaded source')

    // Secret mode turned on after an ordinary run: the route makes it secret and wipes it.
    const { POST: secretRoute } = await import('../app/api/gen/[backend]/job/secret/route')
    const ordinary = await settled(await generate({ prompt: 'a pier' }))
    const mark = (job: unknown) =>
      secretRoute(
        new Request('http://127.0.0.1:3000/api/gen/comfy/job/secret', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ job }) }),
        params({ backend: 'comfy' })
      )
    eq((await mark('someone-else')).status, 409, 'a mark must name the run on screen')
    eq([ordinary?.secret, mock.deleted.length], [false, 1], 'and a refused one changes nothing')
    eq((await mark(ordinary?.id)).status, 200, 'naming it, the run is made secret')
    eq([ordinary?.secret, mock.deleted], [true, ['mock-2', 'mock-3']], 'and its prompt is taken back from ComfyUI')
  } finally {
    await mock.close()
    rmSync(scratch, { recursive: true, force: true })
  }
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
  server.on('upgrade', (_request, socket) => socket.destroy())
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, hits, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/` }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
