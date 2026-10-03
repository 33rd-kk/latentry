// Shared bits for the route handlers.

import { NextResponse } from 'next/server'
import { getAdapter } from '@/lib/backends'
import type { BackendAdapter, BackendStatus, GenerateRequest } from '@/lib/backends/types'

export const NO_STORE = { 'Cache-Control': 'no-store' }

export function jsonError(error: string, status: number, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ error, ...extra }, { status, headers: NO_STORE })
}

export function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): NextResponse {
  return NextResponse.json(body, { status: init.status, headers: { ...NO_STORE, ...init.headers } })
}

/** The adapter for a backend id from the URL; a 404 response for an unknown one. */
export function adapterOr404(id: string): BackendAdapter | NextResponse {
  return getAdapter(id) ?? jsonError('Unknown backend', 404)
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
    image_count: Math.round(num(body.image_count, 1, 1, 16)),
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
  const pose = image(body.pose_image_base64)
  if (pose) {
    request.pose_image_base64 = pose
    request.pose_is_skeleton = body.pose_is_skeleton === true
    request.pose_strength = num(body.pose_strength, 1, 0, 2)
  }
  return request
}

export function modeOf(request: GenerateRequest): 'txt2img' | 'img2img' | 'inpaint' | 'pose' {
  if (request.pose_image_base64) return 'pose'
  if (request.init_image_base64) return request.mask_base64 ? 'inpaint' : 'img2img'
  return 'txt2img'
}
