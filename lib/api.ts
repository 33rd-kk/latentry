// Shared bits for the route handlers. Plain web Response, not NextResponse:
// nothing under lib/ imports Next, so it could serve another HTTP server.

import { getAdapter } from '@/lib/backends'
import { WORKFLOW_NAME, type BackendAdapter, type BackendStatus, type GenerateRequest } from '@/lib/backends/types'
import { HIRES_DEFAULTS, HIRES_LIMITS, maxHiresScale } from '@/lib/diffusion/hires'
import { IMAGE_COUNT_MAX, MAX_REQUEST_BODY_BYTES } from '@/lib/limits'

export const NO_STORE = { 'Cache-Control': 'no-store' }

export function jsonError(error: string, status: number, extra: Record<string, unknown> = {}): Response {
  return Response.json({ error, ...extra }, { status, headers: NO_STORE })
}

export function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return Response.json(body, { status: init.status, headers: { ...NO_STORE, ...init.headers } })
}

/** The adapter for a backend id from the URL; a 404 response for an unknown one. */
export function adapterOr404(id: string): BackendAdapter | Response {
  return getAdapter(id) ?? jsonError('Unknown backend', 404)
}

/**
 * True when the request says its body is larger than Latentry accepts. Next
 * has already cut such a body short, so it would only fail as broken JSON;
 * this lets a route say what really went wrong.
 */
export function bodyTooLarge(request: Request): boolean {
  const length = Number(request.headers.get('content-length'))
  return Number.isFinite(length) && length > MAX_REQUEST_BODY_BYTES
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

// Statuses are asked for by every page poll; a generation start reuses a
// recent one instead of making the backend answer twice.
const globalForStatus = globalThis as typeof globalThis & { __backendStatus?: Map<string, { at: number; status: BackendStatus }> }
const statusCache = (globalForStatus.__backendStatus ??= new Map())

export async function backendStatus(adapter: BackendAdapter, maxAgeMs = 0): Promise<BackendStatus> {
  const cached = statusCache.get(adapter.config.id)
  if (cached && Date.now() - cached.at <= maxAgeMs) return cached.status
  const status = await adapter.status()
  statusCache.set(adapter.config.id, { at: Date.now(), status })
  return status
}

const MAX_IMAGE_CHARS = 32 * 1024 * 1024

function num(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function image(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_IMAGE_CHARS ? value : undefined
}

/**
 * A generate request built field by field from an untrusted body: known
 * fields only, each typed and clamped, so nothing the browser adds reaches a
 * backend. Null when there is no prompt.
 */
export function toGenerateRequest(body: Record<string, unknown>): GenerateRequest | null {
  const prompt = str(body.prompt).trim()
  if (!prompt) return null
  const request: GenerateRequest = {
    prompt,
    negative_prompt: str(body.negative_prompt),
    width: Math.round(num(body.width, 1024, 64, 4096)),
    height: Math.round(num(body.height, 1024, 64, 4096)),
    seed: Math.round(num(body.seed, -1, -1, 2 ** 32 - 1)),
    image_count: Math.round(num(body.image_count, 1, 1, IMAGE_COUNT_MAX)),
    sampler: str(body.sampler, 'Default') || 'Default',
    scheduler: str(body.scheduler, 'Default') || 'Default',
    num_inference_steps: Math.round(num(body.num_inference_steps, 28, 1, 200)),
    guidance_scale: num(body.guidance_scale, 6, 0, 30),
  }
  const init = image(body.init_image_base64)
  if (init) {
    request.init_image_base64 = init
    request.strength = num(body.strength, 0.6, 0.01, 1)
    const mask = image(body.mask_base64)
    if (mask) {
      request.mask_base64 = mask
      if (typeof body.mask_blur === 'number') request.mask_blur = num(body.mask_blur, 4, 0, 64)
    }
  }
  // A file name only; the backend resolves it inside its own folder (lib/backends/comfy-workflows.ts).
  if (typeof body.workflow === 'string' && WORKFLOW_NAME.test(body.workflow)) request.workflow = body.workflow
  const pose = image(body.pose_image_base64)
  if (pose) {
    request.pose_image_base64 = pose
    request.pose_is_skeleton = body.pose_is_skeleton === true
    request.pose_strength = num(body.pose_strength, 1, 0, 2)
  }
  // Upscale: the source itself, larger and redrawn. Nothing else rides along:
  // no mask, no skeleton, no workflow, and no strength (hr_denoise is it).
  const upscale = body.upscale === true && request.init_image_base64 !== undefined && typeof body.hr_scale === 'number'
  if (upscale) {
    delete request.mask_base64
    delete request.mask_blur
    delete request.strength
    delete request.pose_image_base64
    delete request.pose_is_skeleton
    delete request.pose_strength
    delete request.workflow
    request.upscale = true
  }
  // Hires fix redraws a txt2img picture; a source image or a workflow has its own passes.
  if (typeof body.hr_scale === 'number' && (upscale || (!request.init_image_base64 && !request.workflow))) {
    // An upscale's sides are held to 4096 where its source's size is known (hiresSize).
    const maxScale = upscale ? HIRES_LIMITS.maxScale : maxHiresScale(request.width, request.height)
    request.hr_scale = num(body.hr_scale, HIRES_DEFAULTS.scale, HIRES_LIMITS.minScale, maxScale)
    request.hr_steps = Math.round(num(body.hr_steps, HIRES_DEFAULTS.steps, 0, HIRES_LIMITS.maxSteps))
    request.hr_denoise = num(body.hr_denoise, HIRES_DEFAULTS.denoise, HIRES_LIMITS.minDenoise, HIRES_LIMITS.maxDenoise)
    request.hr_upscaler = upscalerName(body.hr_upscaler)
  }
  return request
}

/** An upscaler as the backend lists it: one short line, else the default. */
function upscalerName(value: unknown): string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : HIRES_DEFAULTS.upscaler
}

export function modeOf(request: GenerateRequest): 'txt2img' | 'img2img' | 'inpaint' | 'pose' | 'upscale' {
  if (request.upscale) return 'upscale'
  if (request.pose_image_base64) return 'pose'
  if (request.init_image_base64) return request.mask_base64 ? 'inpaint' : 'img2img'
  return 'txt2img'
}
