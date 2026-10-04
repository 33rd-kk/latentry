// Adapter for a server speaking the diffusers-compatible HTTP API described
// in docs/backend-api.md: POST /api/generate answers with Server-Sent Events,
// one run at a time, and /api/cancel takes the run id from the "start" event.
//
// The events are already the common vocabulary (see ./types), so this mostly
// forwards them, renaming fields to camelCase on the way through.

import { readSseFrames } from '@/lib/diffusion/sse'
import { errorMessage, fetchWithTimeout, getJson, isAbortError } from './http'
import type {
  BackendAdapter,
  BackendConfig,
  BackendEvent,
  BackendStatus,
  GenerateRequest,
  Outcome,
  PoseRequest,
  Preset,
  WdTag,
} from './types'

// What the API's sampler and scheduler fields accept unless /api/health lists
// its own (`samplers` / `schedulers`). Anything else is a 422.
const DEFAULT_SAMPLERS = ['Default', 'Euler', 'DPM++ 2M', 'UniPC']
const DEFAULT_SCHEDULERS = ['Default', 'Karras', 'Exponential']

// Guards only getting the response headers. Once the stream is open there is
// no deadline: a 16-image run at high step counts takes as long as it takes,
// and the server's own events are what show it is alive.
const CONNECT_TIMEOUT_MS = 30 * 1000
const HEALTH_TIMEOUT_MS = 3 * 1000
// The first tag or pose call loads a model on the server's CPU.
const MODEL_CALL_TIMEOUT_MS = 60 * 1000

interface HealthBody {
  model?: unknown
  transformer?: unknown
  num_layers?: unknown
  pose_control?: unknown
  busy?: unknown
  samplers?: unknown
  schedulers?: unknown
  tagger?: unknown
  img2img?: unknown
  inpaint?: unknown
}

function stringList(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') && value.length ? value : null
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** "org/name" → "name"; the repo owner is noise in a one-line label. */
function shortModelName(id: string): string {
  return id.split('/').pop() ?? id
}

export class DiffusersAdapter implements BackendAdapter {
  constructor(readonly config: BackendConfig) {}

  private headers(json = false): HeadersInit {
    return {
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...(this.config.token ? { Authorization: `Bearer ${this.config.token}` } : {}),
    }
  }

  private url(path: string): URL {
    return new URL(path, this.config.url)
  }

  async status(): Promise<BackendStatus> {
    const health = await getJson<HealthBody>(this.url('/api/health'), this.headers(), HEALTH_TIMEOUT_MS)
    const model = typeof health?.model === 'string' ? shortModelName(health.model) : null
    const transformer = typeof health?.transformer === 'string' ? shortModelName(health.transformer) : null
    const layers = finite(health?.num_layers)
    // A transformer swapped in over the base's weights is what actually draws,
    // so it leads; the layer count tells apart two releases of the same name.
    const label = transformer ? `${transformer} (${model})` : model
    return {
      id: this.config.id,
      kind: this.config.kind,
      profile: this.config.profile,
      alive: health !== null,
      busy: health?.busy === true,
      model: label && layers ? `${label} · ${layers} layers` : label,
      capabilities: {
        // Absent means yes: servers written before these flags could do both.
        img2img: health ? health.img2img !== false : false,
        inpaint: health ? health.inpaint !== false : false,
        pose: health?.pose_control === true,
        // A server that says nothing about its tagger is assumed to have one;
        // /api/tag answers 503 when its model is missing, which is shown as such.
        tag: health ? health.tagger !== false : false,
        presets: true,
        preciseCancel: true,
      },
      samplers: stringList(health?.samplers) ?? DEFAULT_SAMPLERS,
      schedulers: stringList(health?.schedulers) ?? DEFAULT_SCHEDULERS,
    }
  }

  async presets(): Promise<{ default: string | null; presets: Preset[] }> {
    const body = await getJson<{ default?: unknown; presets?: unknown }>(
      this.url('/api/presets'),
      this.headers(),
      HEALTH_TIMEOUT_MS
    )
    return {
      default: typeof body?.default === 'string' ? body.default : null,
      presets: Array.isArray(body?.presets) ? (body.presets as Preset[]) : [],
    }
  }

  async start(request: GenerateRequest): Promise<Outcome<AsyncIterable<BackendEvent>>> {
    let response: Response
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS)
    try {
      response = await fetch(this.url('/api/generate'), {
        method: 'POST',
        headers: this.headers(true),
        body: JSON.stringify(request),
        signal: controller.signal,
        cache: 'no-store',
      })
    } catch (error) {
      return isAbortError(error)
        ? { ok: false, status: 504, error: 'Timed out connecting to the backend' }
        : { ok: false, status: 502, error: 'Could not reach the backend' }
    } finally {
      clearTimeout(timer)
    }

    // A refusal arrives before any streaming, as a plain JSON error body.
    if (!response.ok || !response.body) {
      const payload = await response.json().catch(() => null)
      return {
        ok: false,
        status: response.ok ? 502 : response.status,
        error: errorMessage(payload, `Backend error: ${response.status}`),
      }
    }

    return { ok: true, value: this.events(response.body) }
  }

  private async *events(body: ReadableStream<Uint8Array>): AsyncGenerator<BackendEvent> {
    let ended = false
    try {
      for await (const frame of readSseFrames(body)) {
        let data: Record<string, unknown>
        try {
          data = JSON.parse(frame.data)
        } catch {
          continue
        }
        const event = toEvent(frame.event, data)
        if (!event) continue
        yield event
        if (event.type === 'done' || event.type === 'cancelled' || event.type === 'error') {
          ended = true
          return
        }
      }
    } catch (error) {
      console.error(`[${this.config.id}] stream error:`, error)
      ended = true
      yield { type: 'error', message: 'Lost the connection to the backend mid-generation.' }
      return
    }
    // A stream that closes without saying how it ended finished its images.
    if (!ended) yield { type: 'done' }
  }

  async cancel(runId: string | null): Promise<Outcome<{ status: string }>> {
    try {
      const response = await fetchWithTimeout(this.url('/api/cancel'), {
        method: 'POST',
        headers: this.headers(true),
        // Naming the run means a late click cannot stop the run that replaced it.
        body: JSON.stringify({ run_id: runId }),
        timeoutMs: HEALTH_TIMEOUT_MS * 2,
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        return { ok: false, status: response.status, error: errorMessage(payload, `Backend error: ${response.status}`) }
      }
      return { ok: true, value: { status: typeof payload?.status === 'string' ? payload.status : 'cancelling' } }
    } catch {
      return { ok: false, status: 502, error: 'Could not reach the backend' }
    }
  }

  async tag(imageBase64: string): Promise<Outcome<{ tags: WdTag[] }>> {
    const result = await this.postJson('/api/tag', { image_base64: imageBase64 })
    if (!result.ok) return result
    const tags = (result.value as { tags?: unknown })?.tags
    if (!Array.isArray(tags)) return { ok: false, status: 502, error: 'The backend returned no tags' }
    return {
      ok: true,
      value: {
        tags: tags
          .filter((tag): tag is { name: string; score: number; category?: number } =>
            typeof tag?.name === 'string' && typeof tag?.score === 'number'
          )
          .map((tag) => ({ name: tag.name, score: tag.score, category: finite(tag.category) ?? 0 })),
      },
    }
  }

  async pose(request: PoseRequest): Promise<Outcome<unknown>> {
    return this.postJson('/api/pose', request)
  }

  private async postJson(path: string, body: unknown): Promise<Outcome<unknown>> {
    try {
      const response = await fetchWithTimeout(this.url(path), {
        method: 'POST',
        headers: this.headers(true),
        body: JSON.stringify(body),
        timeoutMs: MODEL_CALL_TIMEOUT_MS,
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        return { ok: false, status: response.status, error: errorMessage(payload, `Backend error: ${response.status}`) }
      }
      return { ok: true, value: payload }
    } catch (error) {
      return isAbortError(error)
        ? { ok: false, status: 504, error: 'Timed out waiting for the backend' }
        : { ok: false, status: 502, error: 'Could not reach the backend' }
    }
  }
}

/** One SSE event of the diffusers-compatible API, in the common vocabulary. */
export function toEvent(event: string, data: Record<string, unknown>): BackendEvent | null {
  switch (event) {
    case 'start':
      return {
        type: 'start',
        index: finite(data.index) ?? 0,
        total: finite(data.total) ?? 1,
        steps: finite(data.steps) ?? 0,
        ...(typeof data.run_id === 'string' ? { runId: data.run_id } : {}),
      }
    case 'step':
      return { type: 'step', index: finite(data.index) ?? 0, step: finite(data.step) ?? 0 }
    case 'image':
      if (typeof data.image_base64 !== 'string' || !data.image_base64) return null
      return {
        type: 'image',
        index: finite(data.index) ?? 0,
        ...(finite(data.total) !== null ? { total: finite(data.total)! } : {}),
        seed: finite(data.seed) ?? -1,
        imageBase64: data.image_base64,
        ...(finite(data.steps_observed) ? { stepsObserved: finite(data.steps_observed)! } : {}),
      }
    case 'done':
      return { type: 'done' }
    case 'cancelled':
      return { type: 'cancelled' }
    case 'error':
      return { type: 'error', message: typeof data.message === 'string' ? data.message : 'The backend reported an error.' }
    default:
      return null
  }
}
