// Adapter for a ComfyUI server (its HTTP API: /prompt, /queue, /history,
// /view, /object_info, and the /ws socket for progress).
//
// ComfyUI runs graphs, not requests. Latentry builds a small graph on this
// server (buildComfyGraph) from the page's settings: never a graph from the
// browser. txt2img starts from an empty latent; img2img and inpaint upload
// the source (and mask) into ComfyUI's input folder first. Each picture is one
// queued prompt, run one after another, so a cancel stops the rest. Progress
// comes over the WebSocket; if that cannot be opened, /history is polled
// until the prompt is done.
//
// Pose: Latentry's own engine finds the people and draws the skeleton (pose()
// forwards to it), so the reference picture never goes to ComfyUI. A run
// uploads only the drawn skeleton. The built-in graph follows it with the
// ControlNet chosen for this backend (ControlNetApplyAdvanced), drawn
// OpenPose-style; a workflow takes it in its `latentry:pose` LoadImage, drawn
// the way that node's title asks (comfy-workflows.ts poseSlots).
//
// What stays on the ComfyUI machine: the graph ends in PreviewImage, so the
// picture goes to ComfyUI's temp folder (emptied when it restarts), not its
// output folder. Latentry saves its own copy, with ComfyUI's graph chunks
// taken out: they name the model and LoRA files with their folders. Uploads
// reuse three names per backend (latentry/<id>-source.png, -mask.png,
// -pose.png), so they never pile up. A secret run (from the start, or marked
// while it ran) also takes back its history entries and blanks its uploads
// when it ends.
//
// Known limits, compared with the diffusers-compatible API:
// - Pose needs a running engine, and a ControlNet chosen in Settings (built-in
//   graph) or a `latentry:pose` LoadImage (a workflow).
// - The model is the one chosen for this backend in Settings, else the first
//   checkpoint ComfyUI lists.
// - ComfyUI has no login. A token is sent as a Bearer token, for a proxy in
//   front of it.

import { randomInt, randomUUID } from 'node:crypto'
import { FormData, fetch as undiciFetch, WebSocket } from 'undici'
import { isPng, loraCallsInPrompt, loraName, modelFileName, removePngText, type LoraUse } from '@/lib/image-meta'
import { SECRET_GRACE_MS } from '@/lib/diffusion/job-store'
import { MAX_REQUEST_BODY_BYTES } from '@/lib/limits'
import { engineBackends } from '@/lib/engine/supervisor'
import { getProfile } from '@/lib/profiles'
import { comfyHints, problemOf } from './hints'
import { fillWorkflow, poseSlots, readWorkflow, type ComfyGraph, type SkeletonStyle } from './comfy-workflows'
import { DiffusersAdapter } from './diffusers'
import { blankPng, preparedImages, preparedSkeleton } from './images'
import { errorMessage, isAbortError, REDIRECT_REFUSED, redactPaths } from './http'
import type {
  BackendAdapter,
  BackendConfig,
  BackendEvent,
  BackendProblem,
  BackendStatus,
  GenerateRequest,
  Outcome,
  PoseRequest,
  Preset,
} from './types'

const DEFAULT = 'Default'
const DEFAULT_SAMPLER = 'euler'
const DEFAULT_SCHEDULER = 'normal'
const POLL_MS = 500
const STATUS_TIMEOUT_MS = 4 * 1000
const QUEUE_TIMEOUT_MS = 30 * 1000
const VIEW_TIMEOUT_MS = 60 * 1000
const SOCKET_OPEN_MS = 4 * 1000
const STATIC_CACHE_MS = 60 * 1000
/** How long the backend may stop answering mid-run before the run is given up. */
const LOST_AFTER_MS = 30 * 1000
/** A picture larger than this is not read: the same bound as a request to this server. */
export const MAX_PICTURE_BYTES = MAX_REQUEST_BODY_BYTES
/** ComfyUI's own metadata chunks, removed from what Latentry keeps. */
const GRAPH_CHUNKS = ['prompt', 'workflow']
/** The node the picture is read from. */
export const OUTPUT_NODE = '7'

/** The HTTP and socket the adapter needs, separable so the verify script can play a ComfyUI. */
export interface ComfyTransport {
  get(path: string, timeoutMs: number): Promise<{ status: number; body: unknown }>
  post(path: string, body: unknown, timeoutMs: number): Promise<{ status: number; body: unknown }>
  /** At most `maxBytes`; `bytes` is null for a larger answer. */
  getBytes(path: string, timeoutMs: number, maxBytes: number): Promise<{ status: number; bytes: Buffer | null }>
  /** Opens /ws for this client; null when it cannot. Text frames arrive parsed. */
  listen(clientId: string, onMessage: (message: unknown) => void, onClose: () => void): Promise<{ close(): void } | null>
  /** POST /upload/image: a PNG into ComfyUI's input folder, under `subfolder/name`, replacing one of that name. */
  upload(name: string, subfolder: string, png: Buffer, timeoutMs: number): Promise<{ status: number; body: unknown }>
  sleep(ms: number): Promise<void>
}

function httpTransport(config: BackendConfig): ComfyTransport {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.token) headers.Authorization = `Bearer ${config.token}`

  const call = async (path: string, init: { method: string; body?: string | FormData; timeoutMs: number }) => {
    // Redirects are refused, not followed: they would send the prompt elsewhere.
    const response = await undiciFetch(new URL(path, config.url), {
      method: init.method,
      // A form sets its own multipart Content-Type.
      headers: init.body instanceof FormData ? { ...(config.token ? { Authorization: headers.Authorization } : {}) } : headers,
      body: init.body,
      redirect: 'manual',
      signal: AbortSignal.timeout(init.timeoutMs),
    })
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => {})
      return { status: 502, body: { error: REDIRECT_REFUSED }, response: null }
    }
    return { status: response.status, body: null, response }
  }

  const json = async (path: string, init: { method: string; body?: string | FormData; timeoutMs: number }) => {
    const { status, body, response } = await call(path, init)
    if (!response) return { status, body }
    const text = await response.text()
    try {
      return { status, body: text ? JSON.parse(text) : null }
    } catch {
      return { status, body: { error: text.slice(0, 300) } }
    }
  }

  return {
    get: (path, timeoutMs) => json(path, { method: 'GET', timeoutMs }),
    post: (path, body, timeoutMs) => json(path, { method: 'POST', body: JSON.stringify(body), timeoutMs }),
    async getBytes(path, timeoutMs, maxBytes) {
      const { status, response } = await call(path, { method: 'GET', timeoutMs })
      if (!response) return { status, bytes: null }
      const declared = Number(response.headers.get('content-length'))
      if (Number.isFinite(declared) && declared > maxBytes) {
        await response.body?.cancel().catch(() => {})
        return { status, bytes: null }
      }
      const parts: Buffer[] = []
      let size = 0
      for await (const chunk of response.body ?? []) {
        size += chunk.length
        if (size > maxBytes) return { status, bytes: null }
        parts.push(Buffer.from(chunk))
      }
      return { status, bytes: Buffer.concat(parts) }
    },
    listen(clientId, onMessage, onClose) {
      const url = new URL(`/ws?clientId=${encodeURIComponent(clientId)}`, config.url)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      return new Promise((resolve) => {
        let opened = false
        let socket: WebSocket
        try {
          socket = new WebSocket(url, { headers: config.token ? { Authorization: `Bearer ${config.token}` } : {} })
        } catch {
          resolve(null)
          return
        }
        socket.binaryType = 'arraybuffer'
        const timer = setTimeout(() => {
          if (opened) return
          socket.close()
          resolve(null)
        }, SOCKET_OPEN_MS)
        socket.addEventListener('open', () => {
          opened = true
          clearTimeout(timer)
          resolve({ close: () => socket.close() })
        })
        // Binary frames are live previews; only the JSON status messages matter here.
        socket.addEventListener('message', (event) => {
          if (typeof event.data !== 'string') return
          try {
            onMessage(JSON.parse(event.data))
          } catch {
            // Not JSON: nothing to act on.
          }
        })
        socket.addEventListener('close', () => {
          clearTimeout(timer)
          if (opened) onClose()
          else resolve(null)
        })
        socket.addEventListener('error', () => {
          // A 'close' follows; that is where both cases are handled.
        })
      })
    },
    upload(name, subfolder, png, timeoutMs) {
      const form = new FormData()
      form.append('image', new Blob([new Uint8Array(png)], { type: 'image/png' }), name)
      form.append('subfolder', subfolder)
      form.append('type', 'input')
      form.append('overwrite', 'true')
      return json('/upload/image', { method: 'POST', body: form, timeoutMs })
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }
}

interface Inflight {
  /** The prompt id ComfyUI gave the picture being drawn now. */
  runId: string | null
  cancelRequested: boolean
  /** A secret run (from the start, or marked while it ran): its traces are wiped at the end. */
  secret: boolean
  /** Every prompt this run queued, and the pictures it uploaded, for that wipe. */
  promptIds: string[]
  uploads: string[]
}

/** What a run left on ComfyUI, kept briefly after it ends for a late "secret" mark. */
interface EndedRun {
  endedAt: number
  promptIds: string[]
  uploads: string[]
  wiped: boolean
}

/** Where uploads go in ComfyUI's input folder; each backend reuses its own three names. */
const UPLOAD_FOLDER = 'latentry'
/** At most this many LoRA calls in one prompt (node ids 10…29). */
const MAX_LORAS = 20
/** The node ComfyUI applies a ControlNet with, to positive and negative at once. */
const CONTROLNET_APPLY = 'ControlNetApplyAdvanced'

interface StaticInfo {
  at: number
  checkpoints: string[]
  samplers: string[]
  schedulers: string[]
  loras: string[] | null
  /** ControlNetLoader's files; null when ComfyUI has no such node (or no ControlNetApplyAdvanced). */
  controlnets: string[] | null
}

/** Finds a running engine to draw skeletons with; null when none runs. Separable for the verify script. */
export type PoseReader = () => Pick<BackendAdapter, 'pose'> | null

/** The first of Latentry's running engines: its pose detection is on the CPU, whatever model it has. */
function runningEngine(): Pick<BackendAdapter, 'pose'> | null {
  const engine = engineBackends()[0]
  return engine ? new DiffusersAdapter(engine) : null
}

// Per backend id, so separate requests (each builds its own adapter) share them.
const globalForComfy = globalThis as typeof globalThis & {
  __comfyInflight?: Map<string, Inflight>
  __comfyStatic?: Map<string, StaticInfo>
  __comfyEnded?: Map<string, EndedRun>
}
const inflightRuns = (globalForComfy.__comfyInflight ??= new Map())
const staticInfo = (globalForComfy.__comfyStatic ??= new Map())
const endedRuns = (globalForComfy.__comfyEnded ??= new Map())

/** The choices of one input in an /object_info answer: `[[...names]]`, or the newer `["COMBO", { options }]`. */
export function comboOptions(body: unknown, node: string, input: string): string[] | null {
  const spec = (body as Record<string, { input?: { required?: Record<string, unknown> } }> | null)?.[node]?.input?.required?.[input]
  if (!Array.isArray(spec)) return null
  const list = Array.isArray(spec[0]) ? spec[0] : spec[0] === 'COMBO' ? (spec[1] as { options?: unknown })?.options : null
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : null
}

/** The prompt without its `<lora:…>` calls, which ComfyUI's text encoder would read as words. */
export function withoutLoraCalls(prompt: string): string {
  return prompt
    .replace(/<(?:lora|lyco):[^<>]*>/gi, '')
    .replace(/\s*,(\s*,)+/g, ',')
    .replace(/^[\s,]+|[\s,]+$/g, '')
    .replace(/\s{2,}/g, ' ')
}

/** Matches the prompt's LoRA calls to ComfyUI's LoRA files, by name without folder or extension. */
export function resolveLoras(calls: LoraUse[], files: string[]): { found: { file: string; use: LoraUse }[]; missing: string[] } {
  const byName = new Map(files.map((file) => [loraName(file).toLowerCase(), file]))
  const found: { file: string; use: LoraUse }[] = []
  const missing: string[] = []
  for (const use of calls) {
    const file = byName.get(use.name.toLowerCase())
    if (file) found.push({ file, use })
    else missing.push(use.name)
  }
  return { found, missing }
}

type GraphNode = { class_type: string; inputs: Record<string, unknown> }

/**
 * The graph for one picture, in ComfyUI's API format: checkpoint → LoRA
 * loaders → the two prompts → a latent → KSampler → decode → PreviewImage
 * (node OUTPUT_NODE). The latent is empty for txt2img; with `images`, it is
 * the uploaded source encoded by the checkpoint's VAE (denoise = strength),
 * and with a mask too, only the mask's white is redrawn (SetLatentNoiseMask).
 * With `pose`, both prompts go through ControlNetApplyAdvanced with the
 * uploaded skeleton before KSampler. Pure, so the verify script can read it.
 */
export function buildComfyGraph(
  request: GenerateRequest,
  options: {
    checkpoint: string
    loras: { file: string; weight: number }[]
    seed: number
    sizeMultiple: number
    /** Uploaded pictures, as LoadImage names them ("latentry/x.png"). */
    images?: { source: string; mask?: string; strength: number }
    /** The uploaded skeleton, the ControlNet file to follow it with, and how strongly. */
    pose?: { image: string; controlnet: string; strength: number }
  }
): Record<string, GraphNode> {
  const snap = (value: number) => Math.max(options.sizeMultiple, Math.round(value / options.sizeMultiple) * options.sizeMultiple)
  const graph: Record<string, GraphNode> = {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: options.checkpoint } },
  }
  let model: [string, number] = ['1', 0]
  let clip: [string, number] = ['1', 1]
  options.loras.forEach((lora, index) => {
    const id = String(10 + index)
    graph[id] = {
      class_type: 'LoraLoader',
      inputs: { model, clip, lora_name: lora.file, strength_model: lora.weight, strength_clip: lora.weight },
    }
    model = [id, 0]
    clip = [id, 1]
  })
  graph['2'] = { class_type: 'CLIPTextEncode', inputs: { text: withoutLoraCalls(request.prompt), clip } }
  graph['3'] = { class_type: 'CLIPTextEncode', inputs: { text: request.negative_prompt, clip } }
  let latent: [string, number] = ['4', 0]
  const images = options.images
  if (images) {
    graph['8'] = { class_type: 'LoadImage', inputs: { image: images.source } }
    graph['9'] = { class_type: 'VAEEncode', inputs: { pixels: ['8', 0], vae: ['1', 2] } }
    latent = ['9', 0]
    if (images.mask) {
      // The mask is white (redraw) on black (keep); its red channel is the mask.
      graph['30'] = { class_type: 'LoadImageMask', inputs: { image: images.mask, channel: 'red' } }
      graph['31'] = { class_type: 'SetLatentNoiseMask', inputs: { samples: ['9', 0], mask: ['30', 0] } }
      latent = ['31', 0]
    }
  } else {
    graph['4'] = { class_type: 'EmptyLatentImage', inputs: { width: snap(request.width), height: snap(request.height), batch_size: 1 } }
  }
  let positive: [string, number] = ['2', 0]
  let negative: [string, number] = ['3', 0]
  if (options.pose) {
    graph['32'] = { class_type: 'LoadImage', inputs: { image: options.pose.image } }
    graph['33'] = { class_type: 'ControlNetLoader', inputs: { control_net_name: options.pose.controlnet } }
    graph['34'] = {
      class_type: CONTROLNET_APPLY,
      inputs: {
        positive,
        negative,
        control_net: ['33', 0],
        image: ['32', 0],
        strength: options.pose.strength,
        start_percent: 0,
        end_percent: 1,
        vae: ['1', 2],
      },
    }
    positive = ['34', 0]
    negative = ['34', 1]
  }
  graph['5'] = {
    class_type: 'KSampler',
    inputs: {
      seed: options.seed,
      steps: request.num_inference_steps,
      cfg: request.guidance_scale,
      sampler_name: request.sampler && request.sampler !== DEFAULT ? request.sampler : DEFAULT_SAMPLER,
      scheduler: request.scheduler && request.scheduler !== DEFAULT ? request.scheduler : DEFAULT_SCHEDULER,
      denoise: images ? images.strength : 1,
      model,
      positive,
      negative,
      latent_image: latent,
    },
  }
  graph['6'] = { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } }
  graph[OUTPUT_NODE] = { class_type: 'PreviewImage', inputs: { images: ['6', 0] } }
  return graph
}

/** ComfyUI's refusal of a graph: its message, and the first node error's details. */
function promptError(body: unknown, status: number): string {
  const nodeErrors = (body as { node_errors?: Record<string, { errors?: { message?: unknown; details?: unknown }[] }> } | null)?.node_errors
  const first = nodeErrors ? Object.values(nodeErrors)[0]?.errors?.[0] : undefined
  const base = errorMessage((body as { error?: unknown } | null)?.error ?? body, `Backend error: ${status}`)
  const detail = typeof first?.details === 'string' && first.details ? first.details : typeof first?.message === 'string' ? first.message : ''
  return detail ? `${base} (${redactPaths(detail)})` : base
}

type QueueItem = [number, string, ...unknown[]]

function queueIds(body: unknown): { running: string[]; pending: string[] } {
  const ids = (list: unknown) => (Array.isArray(list) ? (list as QueueItem[]).map((item) => item?.[1]).filter((id): id is string => typeof id === 'string') : [])
  const queue = body as { queue_running?: unknown; queue_pending?: unknown } | null
  return { running: ids(queue?.queue_running), pending: ids(queue?.queue_pending) }
}

interface HistoryEntry {
  outputs?: Record<string, { images?: { filename?: unknown; subfolder?: unknown; type?: unknown }[] }>
  status?: { status_str?: unknown; messages?: [string, Record<string, unknown>][] }
}

export class ComfyUIAdapter implements BackendAdapter {
  private readonly http: ComfyTransport
  private readonly poseReader: PoseReader

  constructor(
    readonly config: BackendConfig,
    transport?: ComfyTransport,
    poseReader?: PoseReader
  ) {
    this.http = transport ?? httpTransport(config)
    this.poseReader = poseReader ?? runningEngine
  }

  private async getOrNull(path: string, timeoutMs = STATUS_TIMEOUT_MS): Promise<unknown | null> {
    try {
      const response = await this.http.get(path, timeoutMs)
      return response.status === 200 ? response.body : null
    } catch {
      return null
    }
  }

  private async staticInfo(): Promise<StaticInfo> {
    // By address as well as id: a backend moved to another server lists that server's files at once.
    const key = `${this.config.id}|${this.config.url}`
    const cached = staticInfo.get(key)
    if (cached && Date.now() - cached.at < STATIC_CACHE_MS) return cached
    const [checkpoints, sampler, loras, controlnets, apply] = await Promise.all([
      this.getOrNull('/object_info/CheckpointLoaderSimple'),
      this.getOrNull('/object_info/KSampler'),
      this.getOrNull('/object_info/LoraLoader'),
      this.getOrNull('/object_info/ControlNetLoader'),
      this.getOrNull(`/object_info/${CONTROLNET_APPLY}`),
    ])
    const canApply = !!apply && typeof apply === 'object' && CONTROLNET_APPLY in apply
    const info: StaticInfo = {
      at: Date.now(),
      checkpoints: comboOptions(checkpoints, 'CheckpointLoaderSimple', 'ckpt_name') ?? [],
      samplers: comboOptions(sampler, 'KSampler', 'sampler_name') ?? [],
      schedulers: comboOptions(sampler, 'KSampler', 'scheduler') ?? [],
      loras: comboOptions(loras, 'LoraLoader', 'lora_name'),
      controlnets: canApply ? comboOptions(controlnets, 'ControlNetLoader', 'control_net_name') : null,
    }
    // Only a complete answer is cached; a ComfyUI still starting is asked again.
    if (checkpoints !== null && sampler !== null) staticInfo.set(key, info)
    return info
  }

  /** The checkpoint files ComfyUI lists, folders included, for the settings page; null when it does not answer. */
  async checkpoints(): Promise<string[] | null> {
    const body = await this.getOrNull('/object_info/CheckpointLoaderSimple')
    return body === null ? null : (comboOptions(body, 'CheckpointLoaderSimple', 'ckpt_name') ?? [])
  }

  /** The ControlNet files ComfyUI lists, folders included, for the settings page; null when it does not answer. */
  async controlnets(): Promise<string[] | null> {
    const body = await this.getOrNull('/object_info/ControlNetLoader')
    return body === null ? null : (comboOptions(body, 'ControlNetLoader', 'control_net_name') ?? [])
  }

  /** What pose on the built-in graph still lacks here, all true when it can run. */
  private poseReady(info: StaticInfo): { nodes: boolean; controlnet: boolean; engine: boolean } {
    return { nodes: info.controlnets !== null, controlnet: !!this.config.controlnet?.trim(), engine: this.poseReader() !== null }
  }

  /** The checkpoint a run uses: the configured one, else the first listed. */
  private checkpointFrom(info: StaticInfo): string | null {
    return this.config.model?.trim() || info.checkpoints[0] || null
  }

  /** Null while /system_stats answers; else why it does not. */
  private async problem(): Promise<BackendProblem | null> {
    // A login node says what it wants; problemOf keeps its words.
    return problemOf(await this.http.get('/system_stats', STATUS_TIMEOUT_MS).catch(() => null))
  }

  async status(): Promise<BackendStatus> {
    const [problem, queue, info] = await Promise.all([this.problem(), this.getOrNull('/queue'), this.staticInfo()])
    const alive = problem === null
    const { running, pending } = queueIds(queue)
    const checkpoint = alive ? this.checkpointFrom(info) : null
    const pose = this.poseReady(info)
    return {
      id: this.config.id,
      kind: this.config.kind,
      profile: this.config.profile,
      alive,
      busy: running.length + pending.length > 0 || inflightRuns.has(this.config.id),
      // The file's name only: the folders under ComfyUI's models folder stay here.
      model: checkpoint ? modelFileName(checkpoint) : null,
      capabilities: {
        img2img: true,
        inpaint: true,
        pose: alive && pose.nodes && pose.controlnet && pose.engine,
        lora: info.loras !== null,
        tag: false,
        presets: false,
        preciseCancel: true,
      },
      hints: comfyHints(alive, pose),
      samplers: info.samplers.length ? [DEFAULT, ...info.samplers] : [],
      schedulers: info.schedulers.length ? [DEFAULT, ...info.schedulers] : [],
      ...(problem ? { problem } : {}),
    }
  }

  async presets(): Promise<{ default: string | null; presets: Preset[] }> {
    return { default: null, presets: [] }
  }

  async start(request: GenerateRequest): Promise<Outcome<AsyncIterable<BackendEvent>>> {
    if (request.pose_image_base64 && !request.pose_is_skeleton) {
      return { ok: false, status: 400, error: 'This backend follows a drawn skeleton only (pose_is_skeleton, from /pose)' }
    }
    if (request.mask_base64 && !request.init_image_base64) return { ok: false, status: 400, error: 'An inpaint mask needs a source image' }
    if (inflightRuns.has(this.config.id)) return { ok: false, status: 409, error: 'This backend is already generating for Latentry' }

    const queue = await this.getOrNull('/queue')
    if (queue === null) return { ok: false, status: 502, error: 'Could not reach the backend' }
    const { running, pending } = queueIds(queue)
    // A prompt queued now would wait behind someone else's, its progress unseen.
    if (running.length + pending.length > 0) return { ok: false, status: 409, error: 'Another client is generating on this backend' }

    const info = await this.staticInfo()
    if (this.config.model && info.checkpoints.length && !info.checkpoints.includes(this.config.model)) {
      return { ok: false, status: 400, error: `The model set for this backend is not in ComfyUI's list: ${modelFileName(this.config.model)}` }
    }
    const calls = loraCallsInPrompt(request.prompt)
    if (calls.length > MAX_LORAS) return { ok: false, status: 400, error: `At most ${MAX_LORAS} LoRAs in one prompt` }
    const { found, missing } = resolveLoras(calls, info.loras ?? [])
    if (missing.length) return { ok: false, status: 400, error: `LoRA not found on this backend: ${missing.join(', ')}` }
    const controlnet = this.config.controlnet?.trim()
    // A workflow brings its own pose nodes; the built-in graph needs the ControlNet.
    if (request.pose_image_base64 && !request.workflow) {
      if (info.controlnets === null) return { ok: false, status: 400, error: `This ComfyUI has no ControlNetLoader and ${CONTROLNET_APPLY}` }
      if (!controlnet) return { ok: false, status: 400, error: 'Choose a Pose ControlNet for this backend in Settings' }
      if (!info.controlnets.includes(controlnet)) {
        return { ok: false, status: 400, error: `The Pose ControlNet set for this backend is not in ComfyUI's list: ${modelFileName(controlnet)}` }
      }
    }

    // Your own workflow, from this backend's folder, in place of the built-in graph.
    let workflow: ComfyGraph | undefined
    if (request.workflow) {
      if (request.init_image_base64) {
        return { ok: false, status: 400, error: 'A workflow draws from a prompt only. Choose the built-in graph for a source image.' }
      }
      if (!this.config.workflowsDir) return { ok: false, status: 400, error: 'This backend has no workflows folder' }
      const read = await readWorkflow(this.config.workflowsDir, request.workflow)
      if ('error' in read) return { ok: false, status: 400, error: read.error }
      // Filled once here, so a workflow Latentry cannot fill is refused before anything is queued.
      const trial = fillWorkflow(read.graph, request, {
        seed: 0,
        prompt: withoutLoraCalls(request.prompt),
        sizeMultiple: 8,
        loras: found,
        ...(request.pose_image_base64 ? { pose: { image: 'trial.png', strength: 1 } } : {}),
      })
      if ('error' in trial) return { ok: false, status: 400, error: trial.error }
      workflow = read.graph
    }
    const checkpoint = workflow ? (this.config.model ?? '') : this.checkpointFrom(info)
    if (!workflow && !checkpoint) return { ok: false, status: 400, error: 'ComfyUI lists no checkpoint to draw with' }

    const inflight: Inflight = { runId: null, cancelRequested: false, secret: request.secret === true, promptIds: [], uploads: [] }
    let drawn = request
    let images: { source: string; mask?: string; strength: number } | undefined
    if (request.init_image_base64) {
      const prepared = await preparedImages(request, getProfile(this.config.profile).sizeMultiple)
      if (!prepared) return { ok: false, status: 400, error: 'Could not read the source image' }
      // Fixed names per backend: the next run overwrites them, so they never pile up.
      const source = await this.uploadPicture(`${this.config.id}-source.png`, prepared.source, inflight)
      if ('error' in source) return { ok: false, status: 502, error: source.error }
      let mask: string | undefined
      if (prepared.mask) {
        const uploaded = await this.uploadPicture(`${this.config.id}-mask.png`, prepared.mask, inflight)
        if ('error' in uploaded) {
          // The source went up already; a secret run takes it back.
          if (inflight.secret) await this.wipe([], inflight.uploads)
          return { ok: false, status: 502, error: uploaded.error }
        }
        mask = uploaded.name
      }
      images = { source: source.name, ...(mask ? { mask } : {}), strength: request.strength ?? 0.6 }
      drawn = { ...request, width: prepared.width, height: prepared.height }
    }
    let pose: { image: string; strength: number } | undefined
    if (request.pose_image_base64) {
      // At the size the latent is drawn at (img2img's is already a multiple).
      const multiple = getProfile(this.config.profile).sizeMultiple
      const snap = (value: number) => Math.max(multiple, Math.round(value / multiple) * multiple)
      const skeleton = await preparedSkeleton(request.pose_image_base64, snap(drawn.width), snap(drawn.height))
      const uploaded = skeleton
        ? await this.uploadPicture(`${this.config.id}-pose.png`, skeleton, inflight)
        : { error: 'Could not read the skeleton image' }
      if ('error' in uploaded) {
        // A source or mask may have gone up already; a secret run takes them back.
        if (inflight.secret && inflight.uploads.length) await this.wipe([], inflight.uploads)
        return { ok: false, status: skeleton ? 502 : 400, error: uploaded.error }
      }
      pose = { image: uploaded.name, strength: request.pose_strength ?? 1 }
    }

    inflightRuns.set(this.config.id, inflight)
    const seed = request.seed >= 0 ? request.seed : randomInt(0, 2 ** 32)
    return { ok: true, value: this.run(drawn, checkpoint ?? '', found, seed, inflight, { images, pose }, workflow) }
  }

  /**
   * The people in a picture and the skeleton to follow, from Latentry's own
   * engine: the picture goes there, not to ComfyUI. Drawn OpenPose-style for
   * the built-in graph, as the SDXL OpenPose ControlNets were trained; for a
   * workflow, the way its `latentry:pose` node asks.
   */
  async pose(request: PoseRequest, options: { workflow?: string } = {}): Promise<Outcome<unknown>> {
    let style: SkeletonStyle = 'openpose'
    if (options.workflow) {
      if (!this.config.workflowsDir) return { ok: false, status: 400, error: 'This backend has no workflows folder' }
      const read = await readWorkflow(this.config.workflowsDir, options.workflow)
      if ('error' in read) return { ok: false, status: 400, error: read.error }
      const slots = poseSlots(read.graph)
      if (!slots) return { ok: false, status: 400, error: 'This workflow cannot follow a skeleton: mark its pose LoadImage latentry:pose' }
      style = slots.style
    }
    const engine = this.poseReader()
    if (!engine?.pose) return { ok: false, status: 503, error: 'Start the built-in engine to read poses' }
    return engine.pose({ ...request, style })
  }

  /** Uploads one picture into ComfyUI's input folder; the name LoadImage takes, or why not. */
  private async uploadPicture(name: string, png: Buffer, inflight: Inflight): Promise<{ name: string } | { error: string }> {
    let answer: { status: number; body: unknown }
    try {
      answer = await this.http.upload(name, UPLOAD_FOLDER, png, QUEUE_TIMEOUT_MS)
    } catch {
      return { error: 'Could not upload the source image to the backend' }
    }
    if (answer.status !== 200) return { error: errorMessage(answer.body, `Backend error: ${answer.status}`) }
    const body = answer.body as { name?: unknown; subfolder?: unknown } | null
    const stored = typeof body?.name === 'string' && body.name ? body.name : name
    const folder = typeof body?.subfolder === 'string' ? body.subfolder : UPLOAD_FOLDER
    inflight.uploads.push(stored)
    return { name: folder ? `${folder}/${stored}` : stored }
  }

  /**
   * What a secret run leaves on ComfyUI, taken back: its prompts' history
   * entries (prompt text and all), and the uploaded pictures overwritten with
   * an empty one. Best effort: ComfyUI may be gone by now.
   */
  private async wipe(promptIds: string[], uploads: string[]): Promise<void> {
    try {
      if (promptIds.length) await this.http.post('/history', { delete: promptIds }, STATUS_TIMEOUT_MS)
      if (uploads.length) {
        const blank = await blankPng()
        for (const name of uploads) await this.http.upload(name, UPLOAD_FOLDER, blank, STATUS_TIMEOUT_MS)
      }
    } catch (error) {
      console.error(`[${this.config.id}] could not wipe a secret run from ComfyUI:`, error instanceof Error ? error.message : error)
    }
  }

  /**
   * Secret mode turned on during the run: from now on it is a secret one. A
   * run that ended within the secret grace is wiped at once.
   */
  async markSecret(): Promise<void> {
    const inflight = inflightRuns.get(this.config.id)
    if (inflight) {
      inflight.secret = true
      return
    }
    const ended = endedRuns.get(this.config.id)
    if (!ended || ended.wiped || Date.now() - ended.endedAt > SECRET_GRACE_MS) return
    ended.wiped = true
    await this.wipe(ended.promptIds, ended.uploads)
  }

  private async *run(
    request: GenerateRequest,
    checkpoint: string,
    loras: { file: string; use: LoraUse }[],
    firstSeed: number,
    inflight: Inflight,
    uploaded: { images?: { source: string; mask?: string; strength: number }; pose?: { image: string; strength: number } },
    workflow?: ComfyGraph
  ): AsyncGenerator<BackendEvent> {
    const total = request.image_count
    const clientId = randomUUID()
    const inbox: unknown[] = []
    let wake: (() => void) | null = null
    let socketOpen = false
    const socket = await this.http
      .listen(
        clientId,
        (message) => {
          inbox.push(message)
          wake?.()
        },
        () => {
          socketOpen = false
          wake?.()
        }
      )
      .catch(() => null)
    socketOpen = socket !== null
    const nextMessage = () =>
      inbox.length
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            wake = resolve
            void this.http.sleep(POLL_MS).then(resolve)
          })
    const sizeMultiple = getProfile(this.config.profile).sizeMultiple
    const applied = loras.map(({ use }) => use)

    try {
      for (let index = 0; index < total; index += 1) {
        if (inflight.cancelRequested) {
          yield { type: 'cancelled' }
          return
        }
        const seed = firstSeed + index
        let graph: Record<string, unknown>
        let output = OUTPUT_NODE
        if (workflow) {
          const filled = fillWorkflow(workflow, request, {
            seed,
            prompt: withoutLoraCalls(request.prompt),
            sizeMultiple,
            ...(this.config.model ? { checkpoint: this.config.model } : {}),
            loras,
            ...(uploaded.pose ? { pose: uploaded.pose } : {}),
          })
          if ('error' in filled) {
            yield { type: 'error', message: filled.error }
            return
          }
          graph = filled.graph
          output = filled.output
        } else {
          graph = buildComfyGraph(request, {
            checkpoint,
            loras: loras.map(({ file, use }) => ({ file, weight: use.weight })),
            seed,
            sizeMultiple,
            ...(uploaded.images ? { images: uploaded.images } : {}),
            ...(uploaded.pose ? { pose: { ...uploaded.pose, controlnet: this.config.controlnet?.trim() ?? '' } } : {}),
          })
        }
        let queued: { status: number; body: unknown }
        try {
          queued = await this.http.post('/prompt', { prompt: graph, client_id: clientId }, QUEUE_TIMEOUT_MS)
        } catch (error) {
          yield { type: 'error', message: isAbortError(error) ? 'Timed out waiting for the backend' : 'Could not reach the backend' }
          return
        }
        const promptId = (queued.body as { prompt_id?: unknown } | null)?.prompt_id
        if (queued.status !== 200 || typeof promptId !== 'string') {
          yield { type: 'error', message: promptError(queued.body, queued.status) }
          return
        }
        inflight.runId = promptId
        inflight.promptIds.push(promptId)
        yield { type: 'start', index, total, steps: request.num_inference_steps, runId: promptId }

        // Wait for the prompt to finish: the socket says so first, /history in any case.
        let ended: 'done' | 'cancelled' | { error: string } | null = null
        let lastStep = 0
        let lastAnswer = Date.now()
        let polls = 0
        while (ended === null) {
          await nextMessage()
          while (inbox.length) {
            const message = inbox.shift() as { type?: unknown; data?: Record<string, unknown> } | null
            const data = message?.data ?? {}
            if (data.prompt_id !== promptId) continue
            if (message?.type === 'progress' && typeof data.value === 'number' && data.value > lastStep) {
              lastStep = data.value
              yield { type: 'step', index, step: data.value }
            } else if (message?.type === 'execution_interrupted') {
              ended = 'cancelled'
            } else if (message?.type === 'execution_error') {
              ended = { error: redactPaths(String(data.exception_message ?? 'The backend could not run the graph')).slice(0, 300) }
            } else if (message?.type === 'execution_success' || (message?.type === 'executing' && data.node === null)) {
              ended = 'done'
            }
          }
          if (ended !== null) break
          // With the socket, /history is only a backstop; without it, the only way to know.
          polls += 1
          if (socketOpen && polls % 8 !== 0) continue
          const history = await this.getOrNull(`/history/${encodeURIComponent(promptId)}`)
          if (history === null) {
            if (Date.now() - lastAnswer > LOST_AFTER_MS) ended = { error: 'Lost the connection to the backend mid-generation.' }
            continue
          }
          lastAnswer = Date.now()
          const entry = (history as Record<string, HistoryEntry>)[promptId]
          if (entry) ended = endOf(entry)
          else if (inflight.cancelRequested) {
            // Taken off the queue before it started: it will never have a history.
            const queue = await this.getOrNull('/queue')
            const { running, pending } = queueIds(queue)
            if (queue !== null && !running.includes(promptId) && !pending.includes(promptId)) ended = 'cancelled'
          }
        }

        if (ended === 'cancelled') {
          yield { type: 'cancelled' }
          return
        }
        if (typeof ended === 'object') {
          yield { type: 'error', message: ended.error }
          return
        }
        const picture = await this.picture(promptId, output)
        if ('error' in picture) {
          yield { type: 'error', message: picture.error }
          return
        }
        yield {
          type: 'image',
          index,
          total,
          seed,
          imageBase64: picture.png.toString('base64'),
          stepsObserved: lastStep || undefined,
          ...(applied.length ? { loras: applied } : {}),
        }
      }
      yield inflight.cancelRequested ? { type: 'cancelled' } : { type: 'done' }
    } finally {
      socket?.close()
      if (inflightRuns.get(this.config.id) === inflight) inflightRuns.delete(this.config.id)
      // Kept for a "secret" mark that arrives just after the end.
      const ended: EndedRun = { endedAt: Date.now(), promptIds: inflight.promptIds, uploads: inflight.uploads, wiped: inflight.secret }
      endedRuns.set(this.config.id, ended)
      setTimeout(() => {
        if (endedRuns.get(this.config.id) === ended) endedRuns.delete(this.config.id)
      }, SECRET_GRACE_MS).unref?.()
      if (inflight.secret) await this.wipe(inflight.promptIds, inflight.uploads)
    }
  }

  /** The finished prompt's picture, from PreviewImage, without ComfyUI's graph chunks. */
  private async picture(promptId: string, output: string): Promise<{ png: Buffer } | { error: string }> {
    const history = await this.getOrNull(`/history/${encodeURIComponent(promptId)}`)
    const image = (history as Record<string, HistoryEntry> | null)?.[promptId]?.outputs?.[output]?.images?.[0]
    if (!image || typeof image.filename !== 'string') return { error: 'The backend finished without a picture' }
    const query = new URLSearchParams({
      filename: image.filename,
      subfolder: typeof image.subfolder === 'string' ? image.subfolder : '',
      type: typeof image.type === 'string' ? image.type : 'temp',
    })
    let answer: { status: number; bytes: Buffer | null }
    try {
      answer = await this.http.getBytes(`/view?${query}`, VIEW_TIMEOUT_MS, MAX_PICTURE_BYTES)
    } catch {
      return { error: 'Could not fetch the picture from the backend' }
    }
    if (answer.status !== 200) return { error: `Backend error: ${answer.status}` }
    if (!answer.bytes) return { error: 'The picture from the backend is too large' }
    if (!isPng(answer.bytes)) return { error: 'The backend answered with something that is not a PNG' }
    return { png: removePngText(answer.bytes, GRAPH_CHUNKS) }
  }

  async cancel(runId: string | null): Promise<Outcome<{ status: string }>> {
    const inflight = inflightRuns.get(this.config.id)
    if (!inflight) return { ok: true, value: { status: 'idle' } }
    if (runId !== null && inflight.runId !== null && inflight.runId !== runId) {
      return { ok: false, status: 409, error: 'That run has already ended' }
    }
    inflight.cancelRequested = true
    const ours = inflight.runId
    if (!ours) return { ok: true, value: { status: 'cancelling' } }

    const queue = await this.getOrNull('/queue')
    if (queue === null) return { ok: false, status: 502, error: 'Could not reach the backend' }
    const { running, pending } = queueIds(queue)
    try {
      // Only our own prompt: interrupting or deleting by id leaves other clients' work alone.
      const response = pending.includes(ours)
        ? await this.http.post('/queue', { delete: [ours] }, STATUS_TIMEOUT_MS)
        : running.includes(ours)
          ? await this.http.post('/interrupt', { prompt_id: ours }, STATUS_TIMEOUT_MS)
          : null
      if (response && response.status !== 200) {
        return { ok: false, status: response.status, error: errorMessage(response.body, `Backend error: ${response.status}`) }
      }
      return { ok: true, value: { status: 'cancelling' } }
    } catch {
      return { ok: false, status: 502, error: 'Could not reach the backend' }
    }
  }
}

/** How a finished prompt ended, from its /history entry. */
function endOf(entry: HistoryEntry): 'done' | 'cancelled' | { error: string } {
  const messages = Array.isArray(entry.status?.messages) ? entry.status.messages : []
  if (messages.some((message) => message?.[0] === 'execution_interrupted')) return 'cancelled'
  const failed = messages.find((message) => message?.[0] === 'execution_error')
  if (failed || entry.status?.status_str === 'error') {
    const text = failed?.[1]?.exception_message
    return { error: redactPaths(typeof text === 'string' && text ? text : 'The backend could not run the graph').slice(0, 300) }
  }
  return 'done'
}
