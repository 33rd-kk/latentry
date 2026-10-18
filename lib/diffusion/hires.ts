// Hires fix: a txt2img picture upscaled, then redrawn at a low denoising
// strength. Its second pass runs exactly `hr_steps` steps (or the first
// pass's count) on every backend, as A1111 and ComfyUI do; the engine asks its
// img2img pipeline for enough to land there. Upscale does the same to a
// picture that already exists (a source sent with `upscale: true`).

import type { GenerateRequest } from '@/lib/backends/types'
import { img2imgSteps } from './img2img'

/** The upscaler every backend that has hires fix offers, and the form's default. */
export const LANCZOS = 'Lanczos'

/** The form's opening values and the limits the server clamps to. */
export const HIRES_DEFAULTS = { scale: 2, steps: 0, denoise: 0.4, upscaler: LANCZOS } as const
export const HIRES_LIMITS = { minScale: 1, maxScale: 4, maxSteps: 200, minDenoise: 0.01, maxDenoise: 1, maxSide: 4096 } as const

/** The size a hires run (or an upscale, from its source's size) ends at: each side scaled, rounded to the model's multiple, at most HIRES_LIMITS.maxSide. */
export function hiresSize(width: number, height: number, scale: number, multiple = 8): { width: number; height: number } {
  const side = (value: number) => Math.max(multiple, Math.min(HIRES_LIMITS.maxSide, Math.round((value * scale) / multiple) * multiple))
  return { width: side(width), height: side(height) }
}

/** Most steps an img2img schedule is asked for, so a low denoise cannot ask for thousands. */
const MAX_SCHEDULE_STEPS = 1000

/**
 * The step count to ask an img2img pass for so that it runs `steps` at
 * `denoise`: the pipelines (and A1111's img2img) run only the tail of their
 * schedule. The engine's hires_schedule.
 */
export function hiresSchedule(steps: number, denoise: number, profile?: string): number {
  let asked = steps
  while (asked < MAX_SCHEDULE_STEPS && img2imgSteps(asked, denoise, profile) < steps) asked += 1
  return asked
}

/** The largest scale that keeps both sides within HIRES_LIMITS.maxSide. */
export function maxHiresScale(width: number, height: number): number {
  return Math.min(HIRES_LIMITS.maxScale, HIRES_LIMITS.maxSide / Math.max(width, height, 1))
}

/** Steps the second pass runs, or 0 when the request has no hires fix. */
export function hiresSteps(request: Pick<GenerateRequest, 'hr_scale' | 'hr_steps' | 'num_inference_steps'>): number {
  if (request.hr_scale === undefined) return 0
  return request.hr_steps || request.num_inference_steps
}
