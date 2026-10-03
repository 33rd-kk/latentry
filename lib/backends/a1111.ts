// Adapter for the AUTOMATIC1111 / Forge web UI API (/sdapi/v1/*), started
// with --api (and --api-auth user:pass if GEN_TOKEN_<ID> is set).
//
// That API is shaped differently from the one the UI speaks: txt2img and
// img2img block until every image is done and answer with all of them at
// once, and progress lives on a separate endpoint. So this adapter keeps the
// request open in the background, polls /sdapi/v1/progress while it waits to
// synthesise "start" and "step", and turns the final answer into one "image"
// per picture. The page cannot tell the difference.
//
// Known limits, compared with the diffusers-compatible API:
// - /sdapi/v1/interrupt stops whatever is running. Cancel only sends it while
//   the run in progress is the one this adapter started (matched by
//   job_timestamp), so it cannot stop someone else's work in the web UI.
// - No pose control (that would mean driving the ControlNet extension).
// - Tagging needs the WD14 tagger extension (/tagger/v1/*).

import sharp from 'sharp'
import { Agent, fetch as undiciFetch } from 'undici'
import { fitToImage, getProfile } from '@/lib/profiles'
import { errorMessage, isAbortError, stripDataUrl } from './http'
import type {
  BackendAdapter,
  BackendConfig,
  BackendEvent,
  BackendStatus,
  GenerateRequest,
  Outcome,
  Preset,
  WdTag,
} from './types'

const DEFAULT = 'Default'
const POLL_MS = 500
const STATUS_TIMEOUT_MS = 4 * 1000
const STATIC_CACHE_MS = 60 * 1000
const TAG_TIMEOUT_MS = 60 * 1000
// Ratings the tagger extension mixes into its answer; never a prompt tag.
const RATING_TAGS = new Set(['general', 'sensitive', 'questionable', 'explicit'])

// The generate call returns only when the last image is done. Node's fetch
// gives up on response headers after five minutes, which a large batch passes
// easily, so it goes through an agent with no header or body deadline.
const longAgent = new Agent({ headersTimeout: 0, bodyTimeout: 0 })

export interface ProgressState {
  job_count?: number
  job_no?: number
  job_timestamp?: string
  sampling_step?: number
  sampling_steps?: number
  interrupted?: boolean
}

/** The HTTP the adapter needs, separable so the verify script can play a web UI. */
export interface A1111Transport {
  get(path: string, timeoutMs: number): Promise<{ status: number; body: unknown }>
  post(path: string, body: unknown, options: { timeoutMs: number | null }): Promise<{ status: number; body: unknown }>
  sleep(ms: number): Promise<void>
}

function httpTransport(config: BackendConfig): A1111Transport {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.token) headers.Authorization = `Basic ${Buffer.from(config.token).toString('base64')}`

  const call = async (path: string, init: { method: string; body?: string; timeoutMs: number | null }) => {
    const response = await undiciFetch(new URL(path, config.url), {
      method: init.method,
      headers,
      body: init.body,
      ...(init.timeoutMs === null ? { dispatcher: longAgent } : { signal: AbortSignal.timeout(init.timeoutMs) }),
    })
    const text = await response.text()
    let body: unknown = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = { error: text.slice(0, 300) }
    }
    return { status: response.status, body }
  }

  return {
    get: (path, timeoutMs) => call(path, { method: 'GET', timeoutMs }),
    post: (path, body, options) => call(path, { method: 'POST', body: JSON.stringify(body), timeoutMs: options.timeoutMs }),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }
}

interface Inflight {
  /** The web UI's job_timestamp for our run, once a progress poll has seen it. */
  runId: string | null
  cancelRequested: boolean
}

interface StaticInfo {
  at: number
  samplers: string[]
  schedulers: string[]
  taggerModel: string | null
}

// Per backend id, so separate requests (each builds its own adapter) share them.
const globalForA1111 = globalThis as typeof globalThis & {
  __a1111Inflight?: Map<string, Inflight>
  __a1111Static?: Map<string, StaticInfo>
}
const inflightRuns = (globalForA1111.__a1111Inflight ??= new Map())
const staticInfo = (globalForA1111.__a1111Static ??= new Map())

function names(body: unknown, key: 'name' | 'label'): string[] {
  if (!Array.isArray(body)) return []
  return body
    .map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>)[key] ?? (item as Record<string, unknown>).name : null))
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
}

/** Picks the tagger model: A1111_TAGGER_MODEL if set, else the first WD one. */
export function chooseTaggerModel(models: string[], preferred?: string): string | null {
  if (!models.length) return null
  if (preferred && models.includes(preferred)) return preferred
  return models.find((model) => /wd/i.test(model)) ?? models[0]
}

/**
 * The tagger extension's answer as WD14 tags. Older builds return one flat
 * { tag: score } map with the ratings mixed in; newer ones split it into
 * { rating, general, character } maps.
 */
export function parseTaggerCaption(caption: unknown): WdTag[] {
  if (!caption || typeof caption !== 'object') return []
  const entries = Object.entries(caption as Record<string, unknown>)
  const tags: WdTag[] = []
  const push = (name: string, score: unknown, category: number) => {
    if (typeof score === 'number' && Number.isFinite(score)) tags.push({ name, score, category })
  }
  const grouped = entries.some(([, value]) => value && typeof value === 'object')
  if (grouped) {
    for (const [group, map] of entries) {
      if (group === 'rating' || !map || typeof map !== 'object') continue
      const category = group === 'character' ? 4 : 0
      for (const [name, score] of Object.entries(map as Record<string, unknown>)) push(name, score, category)
    }
  } else {
    for (const [name, score] of entries) if (!RATING_TAGS.has(name)) push(name, score, 0)
  }
  return tags.sort((a, b) => b.score - a.score)
}

/** A seed list from the `info` string (or object) a generate call returns. */
export function seedsFromInfo(info: unknown): number[] {
  let parsed: unknown = info
  if (typeof info === 'string') {
    try {
      parsed = JSON.parse(info)
    } catch {
      return []
    }
  }
  const seeds = (parsed as { all_seeds?: unknown })?.all_seeds
  return Array.isArray(seeds) ? seeds.filter((seed): seed is number => typeof seed === 'number') : []
}

/**
 * The web UI's mask: white is redrawn, black is kept. Ours is a transparent
 * PNG with the painted strokes opaque, so its alpha channel is exactly that.
 */
async function alphaToMask(maskBase64: string): Promise<string> {
  const png = await sharp(Buffer.from(stripDataUrl(maskBase64), 'base64'))
    .ensureAlpha()
    .extractChannel(3)
    .png()
    .toBuffer()
  return png.toString('base64')
}

async function imageSize(base64: string): Promise<{ width: number; height: number } | null> {
  try {
    const meta = await sharp(Buffer.from(stripDataUrl(base64), 'base64')).metadata()
    return meta.width && meta.height ? { width: meta.width, height: meta.height } : null
  } catch {
    return null
  }
}

/** Our request in the web UI's field names; `null` when the source cannot be read. */
export async function toA1111Payload(
  request: GenerateRequest,
  sizeMultiple: number
): Promise<{ path: string; body: Record<string, unknown> } | null> {
  const body: Record<string, unknown> = {
    prompt: request.prompt,
    negative_prompt: request.negative_prompt,
    seed: request.seed,
    // One image per iteration, so progress (job_no) counts images.
    batch_size: 1,
    n_iter: Math.max(1, Math.min(16, Math.floor(request.image_count))),
    steps: request.num_inference_steps,
    cfg_scale: request.guidance_scale,
    width: request.width,
    height: request.height,
    send_images: true,
    // Latentry saves (with its own metadata) when GALLERY_SAVE_DIR is set; a
    // second copy in the web UI's outputs would be clutter by default.
    save_images: false,
  }
  if (request.sampler && request.sampler !== DEFAULT) body.sampler_name = request.sampler
  if (request.scheduler && request.scheduler !== DEFAULT) body.scheduler = request.scheduler

  if (!request.init_image_base64) return { path: '/sdapi/v1/txt2img', body }

  const size = await imageSize(request.init_image_base64)
  if (!size) return null
  // Fit the output to the source's aspect, as the diffusers-compatible API
  // does server-side; the web UI would otherwise stretch it.
  const fitted = fitToImage(size, request.width, request.height, sizeMultiple)
  body.width = fitted.width
  body.height = fitted.height
  body.init_images = [stripDataUrl(request.init_image_base64)]
  body.denoising_strength = request.strength ?? 0.6
  body.resize_mode = 0
  if (request.mask_base64) {
    body.mask = await alphaToMask(request.mask_base64)
    body.mask_blur = request.mask_blur ?? 4
    // 1 = start from the source's own pixels under the mask.
    body.inpainting_fill = 1
    body.inpaint_full_res = false
    body.inpainting_mask_invert = 0
  }
  return { path: '/sdapi/v1/img2img', body }
}

export class A1111Adapter implements BackendAdapter {
  private readonly http: A1111Transport

  constructor(
    readonly config: BackendConfig,
    transport?: A1111Transport
  ) {
    this.http = transport ?? httpTransport(config)
  }

  private async progress(): Promise<ProgressState | null> {
    try {
      const { status, body } = await this.http.get('/sdapi/v1/progress?skip_current_image=true', STATUS_TIMEOUT_MS)
      if (status !== 200) return null
      return ((body as { state?: ProgressState })?.state ?? {}) as ProgressState
    } catch {
      return null
    }
  }

  private async staticInfo(): Promise<StaticInfo> {
    const cached = staticInfo.get(this.config.id)
    if (cached && Date.now() - cached.at < STATIC_CACHE_MS) return cached

    const get = async (path: string) => {
      try {
        const response = await this.http.get(path, STATUS_TIMEOUT_MS)
        return response.status === 200 ? response.body : null
      } catch {
        return null
      }
    }
    const [samplers, schedulers, interrogators] = await Promise.all([
      get('/sdapi/v1/samplers'),
      get('/sdapi/v1/schedulers'),
      get('/tagger/v1/interrogators'),
    ])
    const models = Array.isArray((interrogators as { models?: unknown })?.models)
      ? ((interrogators as { models: unknown[] }).models.filter((m) => typeof m === 'string') as string[])
      : []
    const info: StaticInfo = {
      at: Date.now(),
      samplers: names(samplers, 'name'),
      // The web UI matches a scheduler by its label ("Karras") as well as its id.
      schedulers: names(schedulers, 'label'),
      taggerModel: chooseTaggerModel(models, process.env.A1111_TAGGER_MODEL?.trim()),
    }
    // Only a complete answer is cached; a web UI still starting up is asked again.
    if (samplers !== null) staticInfo.set(this.config.id, info)
    return info
  }

  async status(): Promise<BackendStatus> {
    const [progress, options, info] = await Promise.all([
      this.progress(),
      this.http.get('/sdapi/v1/options', STATUS_TIMEOUT_MS).catch(() => null),
      this.staticInfo(),
    ])
    const checkpoint = (options?.body as { sd_model_checkpoint?: unknown } | null)?.sd_model_checkpoint
    return {
      id: this.config.id,
      kind: this.config.kind,
      profile: this.config.profile,
      alive: progress !== null,
      busy: (progress?.job_count ?? 0) > 0 || inflightRuns.has(this.config.id),
      model: typeof checkpoint === 'string' ? checkpoint : null,
      capabilities: {
        img2img: true,
        inpaint: true,
        pose: false,
        tag: info.taggerModel !== null,
        presets: false,
        preciseCancel: false,
      },
      samplers: info.samplers.length ? [DEFAULT, ...info.samplers] : [],
      schedulers: info.schedulers.length ? [DEFAULT, ...info.schedulers] : [],
    }
  }

  async presets(): Promise<{ default: string | null; presets: Preset[] }> {
    return { default: null, presets: [] }
  }

  async start(request: GenerateRequest): Promise<Outcome<AsyncIterable<BackendEvent>>> {
    if (request.pose_image_base64) {
      return { ok: false, status: 400, error: 'Pose control is not available on this backend' }
    }
    if (inflightRuns.has(this.config.id)) {
      return { ok: false, status: 409, error: 'This backend is already generating for Latentry' }
    }

    const before = await this.progress()
    if (before === null) return { ok: false, status: 502, error: 'Could not reach the backend' }
    // The web UI queues a second request behind the first, where its progress
    // would belong to someone else's run. Say it is busy instead.
    if ((before.job_count ?? 0) > 0) {
      return { ok: false, status: 409, error: 'Another client is generating on this backend' }
    }

    const payload = await toA1111Payload(request, getProfile(this.config.profile).sizeMultiple)
    if (!payload) return { ok: false, status: 400, error: 'Could not read the source image' }

    const inflight: Inflight = { runId: null, cancelRequested: false }
    inflightRuns.set(this.config.id, inflight)
    return { ok: true, value: this.run(payload, request, before.job_timestamp ?? null, inflight) }
  }

  private async *run(
    payload: { path: string; body: Record<string, unknown> },
    request: GenerateRequest,
    timestampBefore: string | null,
    inflight: Inflight
  ): AsyncGenerator<BackendEvent> {
    const total = payload.body.n_iter as number
    // A holder rather than a `let`: it is written from the promise callbacks,
    // which TypeScript's narrowing inside the loop below cannot see.
    const outcome: { settled: { status: number; body: unknown } | { error: unknown } | null } = { settled: null }
    const call = this.http
      .post(payload.path, payload.body, { timeoutMs: null })
      .then((response) => {
        outcome.settled = response
      })
      .catch((error) => {
        outcome.settled = { error }
      })

    let announced = -1
    let lastStep = -1
    try {
      while (outcome.settled === null) {
        const state = await this.progress()
        // Ours once the timestamp has moved on from the one before we asked.
        if (state && (state.job_count ?? 0) > 0 && state.job_timestamp && state.job_timestamp !== timestampBefore) {
          inflight.runId = state.job_timestamp
          const index = Math.max(0, Math.min(total - 1, state.job_no ?? 0))
          if (index !== announced) {
            announced = index
            lastStep = -1
            yield {
              type: 'start',
              index,
              total,
              steps: state.sampling_steps ?? request.num_inference_steps,
              runId: state.job_timestamp,
            }
          }
          const step = state.sampling_step ?? 0
          if (step !== lastStep && step > 0) {
            lastStep = step
            yield { type: 'step', index, step }
          }
        }
        if (outcome.settled === null) await Promise.race([call, this.http.sleep(POLL_MS)])
      }

      const result = outcome.settled as { status: number; body: unknown } | { error: unknown }
      if ('error' in result) {
        yield {
          type: 'error',
          message: isAbortError(result.error) ? 'Timed out waiting for the backend' : 'Lost the connection to the backend mid-generation.',
        }
        return
      }
      if (result.status !== 200) {
        yield { type: 'error', message: errorMessage(result.body, `Backend error: ${result.status}`) }
        return
      }

      const body = result.body as { images?: unknown; info?: unknown }
      const images = Array.isArray(body?.images) ? body.images.filter((image): image is string => typeof image === 'string') : []
      // With more than one image the web UI can put a grid first; the real
      // images are the last `total` of the list.
      const pictures = images.length > total ? images.slice(images.length - total) : images
      const seeds = seedsFromInfo(body?.info)
      for (let index = 0; index < pictures.length; index += 1) {
        yield {
          type: 'image',
          index,
          total,
          seed: seeds[index] ?? (request.seed >= 0 ? request.seed + index : -1),
          imageBase64: stripDataUrl(pictures[index]),
        }
      }
      yield inflight.cancelRequested ? { type: 'cancelled' } : { type: 'done' }
    } finally {
      if (inflightRuns.get(this.config.id) === inflight) inflightRuns.delete(this.config.id)
    }
  }

  async cancel(runId: string | null): Promise<Outcome<{ status: string }>> {
    const inflight = inflightRuns.get(this.config.id)
    if (!inflight) return { ok: true, value: { status: 'idle' } }
    if (runId !== null && inflight.runId !== null && inflight.runId !== runId) {
      return { ok: false, status: 409, error: 'That run has already ended' }
    }

    const state = await this.progress()
    if (state === null) return { ok: false, status: 502, error: 'Could not reach the backend' }
    // Interrupt is global: send it only while the job on the web UI is ours.
    const running = (state.job_count ?? 0) > 0
    const ours = inflight.runId === null || state.job_timestamp === inflight.runId
    inflight.cancelRequested = true
    if (!running || !ours) return { ok: true, value: { status: 'cancelling' } }

    try {
      const response = await this.http.post('/sdapi/v1/interrupt', {}, { timeoutMs: STATUS_TIMEOUT_MS })
      if (response.status !== 200) {
        return { ok: false, status: response.status, error: errorMessage(response.body, `Backend error: ${response.status}`) }
      }
      return { ok: true, value: { status: 'cancelling' } }
    } catch {
      return { ok: false, status: 502, error: 'Could not reach the backend' }
    }
  }

  async tag(imageBase64: string): Promise<Outcome<{ tags: WdTag[] }>> {
    const { taggerModel } = await this.staticInfo()
    if (!taggerModel) return { ok: false, status: 503, error: 'The WD14 tagger extension is not installed on this backend' }
    try {
      const response = await this.http.post(
        '/tagger/v1/interrogate',
        { image: stripDataUrl(imageBase64), model: taggerModel, threshold: 0.35 },
        { timeoutMs: TAG_TIMEOUT_MS }
      )
      if (response.status !== 200) {
        return { ok: false, status: response.status, error: errorMessage(response.body, `Backend error: ${response.status}`) }
      }
      return { ok: true, value: { tags: parseTaggerCaption((response.body as { caption?: unknown })?.caption) } }
    } catch (error) {
      return isAbortError(error)
        ? { ok: false, status: 504, error: 'Timed out waiting for the backend' }
        : { ok: false, status: 502, error: 'Could not reach the backend' }
    }
  }
}
