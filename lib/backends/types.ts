// The shapes every backend adapter speaks, whatever is on the other end.
//
// The event stream is the diffusers-compatible server's own SSE vocabulary
// (see docs/backend-api.md) taken as the common language: it already says
// everything the UI needs — which image, which step, the finished PNG — and
// the other adapters only have to synthesise it. The job store and the page
// never learn which kind of server a run went to.

import type { LoraUse } from '@/lib/image-meta'
import type { ProfileId } from '@/lib/profiles'

export const BACKEND_KINDS = ['diffusers', 'a1111', 'comfyui'] as const

/** A ComfyUI workflow's name: its file name without `.json`; nothing that could leave its folder. */
export const WORKFLOW_NAME = /^(?!\.{1,2}$)[^\\/:*?"<>|\u0000-\u001f]{1,128}$/
export type BackendKind = (typeof BACKEND_KINDS)[number]

/** One entry of GEN_BACKENDS, with its token. Server-side only. */
export interface BackendConfig {
  id: string
  kind: BackendKind
  url: string
  profile: ProfileId
  /** diffusers and comfyui: a Bearer token. a1111: `user:pass` for --api-auth. */
  token?: string
  /** comfyui: the checkpoint to draw with, as ComfyUI lists it; else its first. */
  model?: string
  /** comfyui: the ControlNet the built-in graph follows a skeleton with, as ComfyUI lists it; no pose without one. */
  controlnet?: string
  /** comfyui: a folder of API-format workflows to pick from on the Generate page. */
  workflowsDir?: string
  /** comfyui: whether paired devices see (and may pick) those workflows by name. */
  shareWorkflows?: boolean
}

export interface Capabilities {
  img2img: boolean
  inpaint: boolean
  /** Skeleton pose control: /api/pose plus pose_* fields on generate. */
  pose: boolean
  /** WD14 tagging of an uploaded picture. */
  tag: boolean
  /** Applies the prompt's `<lora:name:weight>` calls instead of reading them as words. */
  lora: boolean
  /** Speed presets served by the backend. */
  presets: boolean
  /** Cancel stops exactly the run that was asked about, never a later one. */
  preciseCancel: boolean
}

/** The features a backend can lack that the page explains instead of just hiding. */
export const HINTED_FEATURES = ['img2img', 'inpaint', 'pose'] as const
export type HintedFeature = (typeof HINTED_FEATURES)[number]

/**
 * Why a feature is off, so the page can say what would turn it on.
 * - `kind`: this kind of backend cannot do it at all through Latentry.
 * - `not-reported`: the server does not announce it in /api/health.
 * - `declined`: the server says it cannot; `detail` is its own reason, if any.
 */
export interface FeatureHint {
  reason: 'kind' | 'not-reported' | 'declined' | 'setup'
  /** For `setup`: what is missing before Latentry can use the feature there. */
  need?: 'controlnet' | 'engine' | 'nodes' | 'marker'
  /** The server's words, plain text, already trimmed. */
  detail?: string
}

/** What /api/gen/backends tells the browser. No URL and no token, ever. */
export interface BackendStatus {
  id: string
  kind: BackendKind
  profile: ProfileId
  alive: boolean
  /** Something — possibly another client — is generating on it right now. */
  busy: boolean
  /** The loaded model, as the backend names it; null when it does not say. */
  model: string | null
  capabilities: Capabilities
  /** For each hinted feature it cannot use while up: why. Empty when offline. */
  hints: Partial<Record<HintedFeature, FeatureHint>>
  /** The values its sampler / scheduler fields accept; empty hides the field. */
  samplers: string[]
  schedulers: string[]
  /** While it is down: why, when that is known. */
  problem?: BackendProblem
}

/**
 * Why a backend did not answer, shown in place of a bare "not answering":
 * it asked for a login (401 / 403), answered another error status, answered
 * with a redirect (never followed), or did not answer at all.
 */
export interface BackendProblem {
  reason: 'auth' | 'http' | 'redirect' | 'unreachable'
  status?: number
  /** The server's own words, on one line and without paths (see hintDetail). */
  detail?: string
}

/** A generation request, in the diffusers-compatible API's field names. */
export interface GenerateRequest {
  prompt: string
  negative_prompt: string
  width: number
  height: number
  /** -1 for random. */
  seed: number
  image_count: number
  sampler: string
  scheduler: string
  num_inference_steps: number
  guidance_scale: number
  /** img2img source: base64 PNG/JPEG/WebP, bare or as a data: URL. */
  init_image_base64?: string
  strength?: number
  /** Inpaint mask over the source: a PNG whose painted (opaque) pixels are redrawn. */
  mask_base64?: string
  mask_blur?: number
  pose_image_base64?: string
  pose_is_skeleton?: boolean
  pose_strength?: number
  /**
   * Ask for each applied LoRA's hash in the image events. Set by this server
   * from the settings (gallery.loraHashes), never taken from the browser.
   */
  lora_hashes?: boolean
  /**
   * A secret-mode run: a backend that keeps traces of it (ComfyUI's history,
   * uploaded pictures) wipes them when it ends. Set by this server from the
   * run's own flag, not parsed by toGenerateRequest.
   */
  secret?: boolean
  /** comfyui: run this workflow from the backend's folder (its file name, without .json) instead of the built-in graph. */
  workflow?: string
}

export type BackendEvent =
  | { type: 'start'; index: number; total: number; steps: number; runId?: string }
  | { type: 'step'; index: number; step: number }
  | {
      type: 'image'
      index: number
      total?: number
      seed: number
      imageBase64: string
      stepsObserved?: number
      /** The LoRAs the backend applied, when it says; a backend that does not say applied none we know of. */
      loras?: LoraUse[]
    }
  | { type: 'done' }
  | { type: 'cancelled' }
  | { type: 'error'; message: string }

export interface Preset {
  name: string
  label: string
  description: string
  sampler: string
  scheduler: string
  num_inference_steps: number
  approx_seconds: number
}

export interface WdTag {
  name: string
  score: number
  /** WD14's own category: 0 general, 4 character, 9 rating. */
  category: number
}

export interface PoseRequest {
  image_base64: string
  width?: number
  height?: number
  /** An index, -1 for everyone, or some of them by index (backends that answer `person_subsets`). */
  person?: number | number[]
  /** Answer with each person's 3D points too (backends that can turn a pose). */
  want_3d?: boolean
  /** Draw the pose seen from here, in degrees, framed on the canvas (see lib/pose.ts for the limits). */
  camera?: { yaw: number; pitch: number; framing?: { zoom: number; x: number; y: number } }
  /** How to draw the skeleton ("openpose", "dwpose"). Set by this server for the backend that follows it, never by the browser. */
  style?: 'openpose' | 'dwpose'
}

/** A backend's answer that is either a body to pass on or a refusal with its status. */
export type Outcome<T> = { ok: true; value: T } | { ok: false; status: number; error: string }

export interface BackendAdapter {
  readonly config: BackendConfig
  status(): Promise<BackendStatus>
  presets(): Promise<{ default: string | null; presets: Preset[] }>
  /**
   * Starts a run. Resolves once the backend has accepted it (or refused it, with
   * the status to answer with); the events then arrive on `events`, which
   * always ends with `done`, `cancelled` or `error`.
   */
  start(request: GenerateRequest): Promise<Outcome<AsyncIterable<BackendEvent>>>
  /** Stops the run `runId` names, and only that run. Null means "whatever this app started". */
  cancel(runId: string | null): Promise<Outcome<{ status: string }>>
  tag?(imageBase64: string): Promise<Outcome<{ tags: WdTag[] }>>
  /** `workflow`: a ComfyUI workflow the skeleton is drawn for, kept apart so it never reaches another kind's server. */
  pose?(request: PoseRequest, options?: { workflow?: string }): Promise<Outcome<unknown>>
  /**
   * Secret mode was turned on during this app's current (or just-ended) run:
   * treat it as secret from now on, wiping what it left on the backend. A
   * backend that keeps nothing of a run need not implement it.
   */
  markSecret?(): Promise<void>
}
