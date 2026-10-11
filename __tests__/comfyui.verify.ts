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
  withoutLoraCalls,
  type ComfyTransport,
} from '../lib/backends/comfyui'
import { comfyHints } from '../lib/backends/hints'
import { REDIRECT_REFUSED } from '../lib/backends/http'
import { isPng, readPngText, writePngText } from '../lib/image-meta'
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
async function scriptedComfy(options: { socket?: boolean; busy?: boolean; hold?: boolean; refuse?: unknown; fail?: string } = {}) {
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
        if (!options.hold) {
          setTimeout(() => {
            send?.({ type: 'progress', data: { value: 1, max: 2, prompt_id: id } })
            send?.({ type: 'progress', data: { value: 2, max: 2, prompt_id: id } })
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
      return { status: 200, body: {} }
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
  return { transport, calls, graphs, clients, running }
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
  eq(status.capabilities, { img2img: false, inpaint: false, pose: false, lora: true, tag: false, presets: false, preciseCancel: true }, 'capabilities: txt2img with LoRAs, cancel of our own prompt')
  eq(status.hints, comfyHints(true), 'source image, inpaint and pose are explained as not available on this kind')
  eq(comfyHints(false), {}, 'no hints while it is down')
  eq((await new ComfyUIAdapter({ ...CONFIG, id: 'comfy-2', model: 'other.safetensors' }, quiet.transport).status()).model, 'other.safetensors', 'the model set for the backend is the one shown')

  // ── Why it is down ──
  eq(status.problem, undefined, 'no problem while it answers')
  const answering = (stats: () => Promise<{ status: number; body: unknown }>): ComfyTransport => ({
    get: (path) => (path === '/system_stats' ? stats() : Promise.resolve({ status: 404, body: null })),
    post: async () => ({ status: 404, body: null }),
    getBytes: async () => ({ status: 404, bytes: null }),
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
  const source = await adapter.start({ ...REQUEST, init_image_base64: 'iVBORw0KGgo=' })
  check(!source.ok && source.status === 400, 'a source image is refused for now')
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
