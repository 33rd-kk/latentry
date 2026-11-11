// Adapter for stable-diffusion.cpp's sd-server, on its native async API
// (/sdcpp/v1/*): each picture is one img_gen job with an id, polled at
// /sdcpp/v1/jobs/{id} for its step and its picture, and cancelled by that id
// alone, so Cancel never stops another client's job.
//
// Known limits:
// - sd-server has no login. Run it on this computer (Settings warns when it
//   is reached over the network without a token for a proxy in front of it).
// - No pose control and no WD14 tagging.
// - The model is the one sd-server has loaded; Latentry does not switch it.
// - A finished job (with its picture) stays in sd-server's memory until it
//   expires there; there is no call to delete it sooner.
//
// Beside it: sdcpp-payload.ts (capabilities and the job body).

import { decodeImage } from '@/lib/images/decode'
import { getProfile } from '@/lib/profiles'
import { DEFAULT } from './a1111-payload'
import { jsonTransport, type A1111Transport } from './a1111-transport'
import { errorMessage, isAbortError, redactPaths, stripDataUrl } from './http'
import { problemOf, sdcppHints } from './hints'
import { parseCapabilities, seedOf, toSdcppPlan, upscalerList, type SdcppEnlarge, type SdcppInfo, type SdcppPlan } from './sdcpp-payload'
import type { BackendAdapter, BackendConfig, BackendEvent, BackendStatus, GenerateRequest, Outcome, Preset } from './types'

const POLL_MS = 500
const STATUS_TIMEOUT_MS = 4 * 1000
const CALL_TIMEOUT_MS = 30 * 1000
// The ESRGAN upscale answers only once it is done.
const UPSCALE_TIMEOUT_MS = 5 * 60 * 1000
/** Polls in a row that may fail (about 30 s) before the run is given up as lost. */
const MAX_POLL_FAILURES = 60

interface Inflight {
  /** The first job's id: what the page's Cancel names. */
  runId: string | null
  /** The job drawing now. */
  jobId: string | null
  cancelRequested: boolean
}

// Per backend id, so separate requests (each builds its own adapter) share it.
const globalForSdcpp = globalThis as typeof globalThis & { __sdcppInflight?: Map<string, Inflight> }
const inflightRuns = (globalForSdcpp.__sdcppInflight ??= new Map())

/** /sdcpp/v1/jobs/{id}, the parts read here. */
interface Job {
  status?: unknown
  preview?: { pass?: unknown; step?: unknown; total_steps?: unknown } | null
  result?: { images?: unknown } | null
  error?: { code?: unknown; message?: unknown } | null
}

function int(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

/** A seed for a picture of a random run, chosen here so its record can say it. */
function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 32)
}

export class SdcppAdapter implements BackendAdapter {
  private readonly http: A1111Transport

  constructor(
    readonly config: BackendConfig,
    transport?: A1111Transport
  ) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (config.token) headers.Authorization = `Bearer ${config.token}`
    this.http = transport ?? jsonTransport(config.url, headers)
  }

  /** Its capabilities, or why it did not answer. */
  private async capabilities(): Promise<{ info: SdcppInfo | null; problem: BackendStatus['problem'] | null }> {
    const answer = await this.http.get('/sdcpp/v1/capabilities', STATUS_TIMEOUT_MS).catch(() => null)
    if (answer?.status === 200) return { info: parseCapabilities(answer.body), problem: null }
    return { info: null, problem: problemOf(answer) ?? { reason: 'http', status: answer?.status } }
  }

  async status(): Promise<BackendStatus> {
    const { info, problem } = await this.capabilities()
    const ready = info?.ready === true
    const has = (feature: string) => ready && (info?.features.has(feature) ?? false)
    return {
      id: this.config.id,
      kind: this.config.kind,
      profile: this.config.profile,
      alive: ready,
      busy: inflightRuns.has(this.config.id),
      model: info?.model ?? null,
      capabilities: {
        img2img: has('init_image'),
        inpaint: has('init_image') && has('mask_image'),
        pose: false,
        tag: false,
        lora: has('lora'),
        presets: false,
        preciseCancel: true,
        hires: has('hires'),
        // The source is enlarged here (or by its ESRGAN model), then redrawn as img2img.
        upscale: has('init_image'),
      },
      hints: sdcppHints(ready, { img2img: has('init_image'), inpaint: has('init_image') && has('mask_image'), hires: has('hires') }),
      samplers: ready && info?.samplers.length ? [DEFAULT, ...info.samplers] : [],
      schedulers: ready && info?.schedulers.length ? [DEFAULT, ...info.schedulers] : [],
      upscalers: ready && info && has('hires') ? upscalerList(info) : [],
      // Up but with nothing to draw with: shown as why it is not usable.
      ...(problem
        ? { problem }
        : info && !ready
          ? { problem: { reason: 'http' as const, status: 503, ...(info.notReady ? { detail: info.notReady } : {}) } }
          : {}),
    }
  }

  async presets(): Promise<{ default: string | null; presets: Preset[] }> {
    return { default: null, presets: [] }
  }

  async start(request: GenerateRequest): Promise<Outcome<AsyncIterable<BackendEvent>>> {
    if (request.pose_image_base64) return { ok: false, status: 400, error: 'Pose control is not available on this backend' }
    if (inflightRuns.has(this.config.id)) return { ok: false, status: 409, error: 'This backend is already generating for Latentry' }

    const { info } = await this.capabilities()
    if (!info) return { ok: false, status: 502, error: 'Could not reach the backend' }
    if (!info.ready) return { ok: false, status: 503, error: info.notReady ?? 'No model is loaded on this backend' }

    const plan = await toSdcppPlan(request, info, getProfile(this.config.profile).sizeMultiple)
    if (typeof plan === 'string') return { ok: false, status: 400, error: plan }

    const inflight: Inflight = { runId: null, jobId: null, cancelRequested: false }
    inflightRuns.set(this.config.id, inflight)
    return { ok: true, value: this.run(plan, request, inflight) }
  }

  private release(inflight: Inflight): void {
    if (inflightRuns.get(this.config.id) === inflight) inflightRuns.delete(this.config.id)
  }

  /** An upscale's source at its target size, as bare base64, or why not. */
  private async enlarged(enlarge: SdcppEnlarge): Promise<{ image: string } | { error: string }> {
    let source = stripDataUrl(enlarge.source)
    if (enlarge.model) {
      try {
        const answer = await this.http.post('/sdcpp/v1/upscale', { image: source, upscaler: enlarge.model, output_format: 'png' }, { timeoutMs: UPSCALE_TIMEOUT_MS })
        const images = (answer.body as { images?: { b64_json?: unknown }[] } | null)?.images
        const image = Array.isArray(images) ? images[0]?.b64_json : undefined
        if (answer.status !== 200 || typeof image !== 'string' || !image) return { error: errorMessage(answer.body, `Backend error: ${answer.status}`) }
        source = image
      } catch (error) {
        return { error: isAbortError(error) ? 'Timed out waiting for the backend' : 'Could not reach the backend' }
      }
    }
    try {
      const png = await decodeImage(Buffer.from(source, 'base64')).resize(enlarge.width, enlarge.height, { fit: 'fill', kernel: enlarge.kernel }).png().toBuffer()
      return { image: png.toString('base64') }
    } catch {
      return { error: 'Could not read the source image' }
    }
  }

  private async *run(plan: SdcppPlan, request: GenerateRequest, inflight: Inflight): AsyncGenerator<BackendEvent> {
    const total = Math.max(1, Math.floor(request.image_count))
    try {
      if (plan.enlarge) {
        const enlarged = await this.enlarged(plan.enlarge)
        if ('error' in enlarged) {
          yield { type: 'error', message: enlarged.error }
          return
        }
        plan.body.init_image = enlarged.image
      }
      const firstSeed = request.seed >= 0 ? request.seed : null
      for (let index = 0; index < total; index += 1) {
        if (inflight.cancelRequested) {
          yield { type: 'cancelled' }
          return
        }
        const seed = firstSeed !== null ? firstSeed + index : randomSeed()
        const outcome = yield* this.picture(plan, { ...plan.body, seed }, index, total, inflight)
        if (outcome === 'stop') return
        yield { type: 'image', index, total, seed: outcome.seed ?? seed, imageBase64: outcome.image, ...(plan.loras.length ? { loras: plan.loras } : {}) }
      }
      yield inflight.cancelRequested ? { type: 'cancelled' } : { type: 'done' }
    } finally {
      // A run left early (the page went away) stops its job on the server too.
      if (inflight.jobId) await this.cancelJob(inflight.jobId).catch(() => {})
      this.release(inflight)
    }
  }

  /** One job, from submission to its picture; 'stop' once it has said why it ended. */
  private async *picture(
    plan: SdcppPlan,
    body: Record<string, unknown>,
    index: number,
    total: number,
    inflight: Inflight
  ): AsyncGenerator<BackendEvent, { image: string; seed: number | null } | 'stop'> {
    let submitted: { status: number; body: unknown }
    try {
      submitted = await this.http.post('/sdcpp/v1/img_gen', body, { timeoutMs: CALL_TIMEOUT_MS })
    } catch (error) {
      yield { type: 'error', message: isAbortError(error) ? 'Timed out waiting for the backend' : 'Could not reach the backend' }
      return 'stop'
    }
    const id = (submitted.body as { id?: unknown } | null)?.id
    if ((submitted.status !== 202 && submitted.status !== 200) || typeof id !== 'string' || !id) {
      yield {
        type: 'error',
        message: submitted.status === 429 ? 'The backend’s queue is full; try again in a moment' : errorMessage(submitted.body, `Backend error: ${submitted.status}`),
      }
      return 'stop'
    }
    inflight.jobId = id
    inflight.runId ??= id
    // Cancel may have come while the job was being submitted.
    if (inflight.cancelRequested) await this.cancelJob(id).catch(() => {})

    let steps = plan.steps
    yield { type: 'start', index, total, steps, runId: inflight.runId }
    let firstPass = plan.firstPass
    let lastStep = 0
    let failures = 0
    for (;;) {
      await this.http.sleep(POLL_MS)
      let answer: { status: number; body: unknown }
      try {
        answer = await this.http.get(`/sdcpp/v1/jobs/${encodeURIComponent(id)}`, STATUS_TIMEOUT_MS)
      } catch {
        failures += 1
        if (failures >= MAX_POLL_FAILURES) {
          inflight.jobId = null
          yield { type: 'error', message: 'Lost the connection to the backend mid-generation.' }
          return 'stop'
        }
        continue
      }
      if (answer.status === 404 || answer.status === 410) {
        inflight.jobId = null
        yield { type: 'error', message: 'The backend no longer has this run (it was restarted, or the run expired).' }
        return 'stop'
      }
      if (answer.status !== 200) {
        failures += 1
        if (failures >= MAX_POLL_FAILURES) {
          inflight.jobId = null
          yield { type: 'error', message: errorMessage(answer.body, `Backend error: ${answer.status}`) }
          return 'stop'
        }
        continue
      }
      failures = 0
      const job = (answer.body ?? {}) as Job
      const preview = job.preview ?? null
      const pass = int(preview?.pass) ?? 1
      const passSteps = int(preview?.total_steps)
      const step = int(preview?.step)
      if (pass === 1 && passSteps && passSteps !== firstPass) {
        // The server's own count (an img2img runs only the tail of its schedule).
        steps += passSteps - firstPass
        firstPass = passSteps
        yield { type: 'start', index, total, steps, runId: inflight.runId }
      }
      if (step !== null && step > 0) {
        const at = Math.min(steps, (pass > 1 ? firstPass : 0) + step)
        if (at !== lastStep) {
          lastStep = at
          yield { type: 'step', index, step: at }
        }
      }

      if (job.status === 'completed') {
        inflight.jobId = null
        const images = Array.isArray(job.result?.images) ? job.result.images : []
        const first = images[0] as { b64_json?: unknown } | undefined
        if (typeof first?.b64_json !== 'string' || !first.b64_json) {
          yield { type: 'error', message: 'The backend finished without a picture' }
          return 'stop'
        }
        return { image: stripDataUrl(first.b64_json), seed: seedOf(first) }
      }
      if (job.status === 'cancelled') {
        inflight.jobId = null
        yield { type: 'cancelled' }
        return 'stop'
      }
      if (job.status === 'failed') {
        inflight.jobId = null
        const message = typeof job.error?.message === 'string' && job.error.message.trim() ? redactPaths(job.error.message.trim()) : 'The backend could not draw this picture'
        yield { type: 'error', message }
        return 'stop'
      }
    }
  }

  private async cancelJob(id: string): Promise<{ status: number; body: unknown }> {
    return this.http.post(`/sdcpp/v1/jobs/${encodeURIComponent(id)}/cancel`, {}, { timeoutMs: STATUS_TIMEOUT_MS })
  }

  async cancel(runId: string | null): Promise<Outcome<{ status: string }>> {
    const inflight = inflightRuns.get(this.config.id)
    if (!inflight) return { ok: true, value: { status: 'idle' } }
    if (runId !== null && inflight.runId !== null && inflight.runId !== runId) {
      return { ok: false, status: 409, error: 'That run has already ended' }
    }
    inflight.cancelRequested = true
    // Only our own job, by its id: another client's work on the server is never touched.
    const jobId = inflight.jobId
    if (!jobId) return { ok: true, value: { status: 'cancelling' } }
    try {
      const response = await this.cancelJob(jobId)
      // Already over (404 / 409 / 410): the poll says how it ended.
      if (response.status === 200 || response.status === 404 || response.status === 409 || response.status === 410) {
        return { ok: true, value: { status: 'cancelling' } }
      }
      return { ok: false, status: response.status, error: errorMessage(response.body, `Backend error: ${response.status}`) }
    } catch {
      return { ok: false, status: 502, error: 'Could not reach the backend' }
    }
  }
}
