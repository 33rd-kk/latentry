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
//
// Beside it: a1111-transport.ts (the HTTP), a1111-payload.ts (a request in
// the web UI's field names) and a1111-tagger.ts (the tagger's answer).

import { hiresSteps, LANCZOS } from '@/lib/diffusion/hires'
import { loraCallsInPrompt } from '@/lib/image-meta'
import { getProfile } from '@/lib/profiles'
import { a1111Hints, problemOf } from './hints'
import { errorMessage, isAbortError, stripDataUrl } from './http'
import { DEFAULT, seedsFromInfo, toA1111Payload } from './a1111-payload'
import { chooseTaggerModel, parseTaggerCaption } from './a1111-tagger'
import { httpTransport, type A1111Transport, type ProgressState } from './a1111-transport'
import type {
  BackendAdapter,
  BackendConfig,
  BackendEvent,
  BackendProblem,
  BackendStatus,
  GenerateRequest,
  Outcome,
  Preset,
  WdTag,
} from './types'

const POLL_MS = 500
const STATUS_TIMEOUT_MS = 4 * 1000
const STATIC_CACHE_MS = 60 * 1000
const TAG_TIMEOUT_MS = 60 * 1000

interface Inflight {
  /** The web UI's job_timestamp for our run, once a progress poll has seen it. */
  runId: string | null
  cancelRequested: boolean
}

interface StaticInfo {
  at: number
  samplers: string[]
  schedulers: string[]
  upscalers: string[]
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

export class A1111Adapter implements BackendAdapter {
  private readonly http: A1111Transport

  constructor(
    readonly config: BackendConfig,
    transport?: A1111Transport
  ) {
    this.http = transport ?? httpTransport(config)
  }

  /** The web UI's progress, or why it did not answer. */
  private async probe(): Promise<{ state: ProgressState | null; problem: BackendProblem | null }> {
    const answer = await this.http.get('/sdapi/v1/progress?skip_current_image=true', STATUS_TIMEOUT_MS).catch(() => null)
    if (answer?.status === 200) return { state: ((answer.body as { state?: ProgressState })?.state ?? {}) as ProgressState, problem: null }
    return { state: null, problem: problemOf(answer) ?? { reason: 'http', status: answer?.status } }
  }

  private async progress(): Promise<ProgressState | null> {
    return (await this.probe()).state
  }

  private async staticInfo(): Promise<StaticInfo> {
    // By address as well as id: a backend moved to another server lists that server's samplers at once.
    const key = `${this.config.id}|${this.config.url}`
    const cached = staticInfo.get(key)
    if (cached && Date.now() - cached.at < STATIC_CACHE_MS) return cached

    const get = async (path: string) => {
      try {
        const response = await this.http.get(path, STATUS_TIMEOUT_MS)
        return response.status === 200 ? response.body : null
      } catch {
        return null
      }
    }
    const [samplers, schedulers, upscalers, latentModes, interrogators] = await Promise.all([
      get('/sdapi/v1/samplers'),
      get('/sdapi/v1/schedulers'),
      get('/sdapi/v1/upscalers'),
      get('/sdapi/v1/latent-upscale-modes'),
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
      // Pixel upscalers ("None" is no upscaler, so no hires fix), then the latent ones.
      upscalers: [...names(upscalers, 'name').filter((name) => name !== 'None'), ...names(latentModes, 'name')],
      taggerModel: chooseTaggerModel(models, process.env.A1111_TAGGER_MODEL?.trim()),
    }
    // Only a complete answer is cached; a web UI still starting up is asked again.
    if (samplers !== null) staticInfo.set(key, info)
    return info
  }

  async status(): Promise<BackendStatus> {
    const [{ state: progress, problem }, options, info] = await Promise.all([
      this.probe(),
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
      // The file's name only: A1111 names it by its path under its models
      // folder ("sdxl\anime\x.safetensors [hash]"), and folder names stay here.
      model: typeof checkpoint === 'string' ? (checkpoint.split(/[\\/]/).pop() ?? checkpoint) : null,
      capabilities: {
        img2img: true,
        inpaint: true,
        pose: false,
        lora: true,
        tag: info.taggerModel !== null,
        presets: false,
        preciseCancel: false,
        hires: true,
      },
      hints: a1111Hints(progress !== null),
      samplers: info.samplers.length ? [DEFAULT, ...info.samplers] : [],
      schedulers: info.schedulers.length ? [DEFAULT, ...info.schedulers] : [],
      // Lanczos is built into the web UI; a list it did not give still has that.
      upscalers: info.upscalers.length ? info.upscalers : [LANCZOS],
      ...(problem ? { problem } : {}),
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

    // Hires fix samples each picture twice, and the web UI counts each pass from
    // one: the bar runs on through both, the second pass after the first's steps.
    const hiresPass = hiresSteps(request)
    let announced = -1
    let announcedSteps = -1
    let passSteps = -1
    let secondPass = false
    let lastStep = -1
    try {
      while (outcome.settled === null) {
        const state = await this.progress()
        // Ours once the timestamp has moved on from the one before we asked.
        if (state && (state.job_count ?? 0) > 0 && state.job_timestamp && state.job_timestamp !== timestampBefore) {
          inflight.runId = state.job_timestamp
          const index = Math.max(0, Math.min(total - 1, state.job_no ?? 0))
          const sampling = state.sampling_steps || request.num_inference_steps
          const step = state.sampling_step ?? 0
          if (index !== announced) secondPass = false
          // The second pass has begun once the first has drawn and then the
          // count changes from the first pass's, or the step starts over.
          else if (
            hiresPass &&
            !secondPass &&
            lastStep > 0 &&
            ((sampling !== passSteps && passSteps === request.num_inference_steps) || (step > 0 && step < lastStep))
          ) {
            secondPass = true
          }
          passSteps = sampling
          const offset = secondPass ? request.num_inference_steps : 0
          const steps = secondPass ? offset + sampling : sampling + hiresPass
          // The web UI sets the step count only when sampling starts, a moment
          // after the job: until then it still holds the previous run's (20
          // from a txt2img while this img2img does 11). Announced again when
          // it changes, so the bar ends where the run does.
          if (index !== announced || steps !== announcedSteps) {
            announced = index
            announcedSteps = steps
            lastStep = -1
            yield { type: 'start', index, total, steps, runId: state.job_timestamp }
          }
          if (step !== lastStep && step > 0) {
            lastStep = step
            yield { type: 'step', index, step: offset + step }
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
      const loras = loraCallsInPrompt(request.prompt)
      for (let index = 0; index < pictures.length; index += 1) {
        yield {
          type: 'image',
          index,
          total,
          seed: seeds[index] ?? (request.seed >= 0 ? request.seed + index : -1),
          imageBase64: stripDataUrl(pictures[index]),
          // A1111 applies the prompt's LoRA calls itself.
          ...(loras.length ? { loras } : {}),
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
