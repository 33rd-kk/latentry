// stable-diffusion.cpp's sd-server, in its own words: what its
// /sdcpp/v1/capabilities says it can do, and Latentry's request as the body
// of one /sdcpp/v1/img_gen job. Used by ./sdcpp.ts.
//
// Reference: examples/server/api.md in leejet/stable-diffusion.cpp.

import sharp from 'sharp'
import { hiresSize, LANCZOS } from '@/lib/diffusion/hires'
import { loraCallsInPrompt, loraName, type LoraUse } from '@/lib/image-meta'
import { DEFAULT } from './a1111-payload'
import { resolveLoras, withoutLoraCalls } from './comfyui'
import { imageSize, preparedImages } from './images'
import { redactPaths } from './http'
import type { GenerateRequest } from './types'

/** Its hires upscaler that is no upscaler at all. */
const NONE = 'None'
/** At most this many LoRAs in one prompt, as on ComfyUI. */
export const MAX_SDCPP_LORAS = 20

export interface SdcppUpscaler {
  name: string
  /** It can enlarge a picture on its own (/sdcpp/v1/upscale): an RGB ESRGAN model. */
  imageUpscale: boolean
}

/** What /sdcpp/v1/capabilities says, read defensively. Never a path. */
export interface SdcppInfo {
  /** The loaded model's file name (stem), never its folder; null while none is loaded. */
  model: string | null
  /** A model is loaded and ready to draw. */
  ready: boolean
  /** Why not, when it says (its own words, paths taken out). */
  notReady?: string
  /** features_by_mode.img_gen, the ones set to true. */
  features: Set<string>
  samplers: string[]
  schedulers: string[]
  /** LoRAs by name, with the `path` id the server takes back in `lora[]`. */
  loras: { name: string; path: string }[]
  upscalers: SdcppUpscaler[]
  previewModes: string[]
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : []
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** The last part of a name that may carry folders, as every adapter shows a model. */
function fileName(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  return value.trim().split(/[\\/]/).pop() || null
}

export function parseCapabilities(body: unknown): SdcppInfo {
  const caps = record(body)
  const byMode = record(record(caps.features_by_mode).img_gen)
  // An older server has only the top-level mirror of the current mode.
  const flags = Object.keys(byMode).length ? byMode : record(caps.features)
  const features = new Set(Object.entries(flags).filter(([, on]) => on === true).map(([name]) => name))
  const model = record(caps.model)
  const runtime = record(caps.runtime)
  const state = typeof runtime.state === 'string' ? runtime.state : null
  const supported = strings(caps.supported_modes)
  const ready = (state === null || state === 'ready') && (supported.length === 0 || supported.includes('img_gen'))
  const loras = (Array.isArray(caps.loras) ? caps.loras : []).flatMap((item) => {
    const { name, path } = record(item)
    return typeof name === 'string' && name && typeof path === 'string' && path ? [{ name, path }] : []
  })
  const upscalers = (Array.isArray(caps.upscalers) ? caps.upscalers : []).flatMap((item) => {
    const entry = record(item)
    const name = entry.name
    return typeof name === 'string' && name && name !== NONE ? [{ name, imageUpscale: entry.image_upscale === true }] : []
  })
  const error = typeof runtime.error === 'string' && runtime.error.trim() ? redactPaths(runtime.error.trim()) : undefined
  return {
    model: ready ? (fileName(model.stem) ?? fileName(model.name)) : null,
    ready,
    ...(ready ? {} : { notReady: error ?? (state && state !== 'ready' ? `No model is ready (${state})` : 'This server cannot draw pictures') }),
    features,
    samplers: strings(caps.samplers),
    schedulers: strings(caps.schedulers),
    loras,
    upscalers,
    previewModes: strings(caps.preview_modes),
  }
}

/** The hires upscalers as the page lists them: Lanczos first, each once. */
export function upscalerList(info: SdcppInfo): string[] {
  return [...new Set([LANCZOS, ...info.upscalers.map((upscaler) => upscaler.name)])]
}

/** The cheapest preview that still reports the step: the latent projection, else none. */
export function previewMode(info: SdcppInfo): string {
  return info.previewModes.includes('proj') ? 'proj' : 'none'
}

/** The source enlarged before an upscale's redraw: by sharp (Lanczos, Nearest) or by the server's ESRGAN model. */
export interface SdcppEnlarge {
  source: string
  width: number
  height: number
  /** A model name for /sdcpp/v1/upscale; null for sharp's resize. */
  model: string | null
  kernel: 'lanczos3' | 'nearest'
}

export interface SdcppPlan {
  /** img_gen's body, one picture; `seed` is set per picture. */
  body: Record<string, unknown>
  /** For an upscale, what to enlarge before `body.init_image` is filled in. */
  enlarge?: SdcppEnlarge
  /** Steps the bar runs per picture, as Latentry counts them, before the server says. */
  steps: number
  /** The first pass's steps, after which a hires second pass counts on. */
  firstPass: number
  loras: LoraUse[]
}

/**
 * Our request as one img_gen job (one picture each, so progress, seeds and
 * cancel are per picture). A string is a refusal to answer with 400.
 */
export async function toSdcppPlan(request: GenerateRequest, info: SdcppInfo, sizeMultiple: number): Promise<SdcppPlan | string> {
  if (request.pose_image_base64) return 'Pose control is not available on this backend'

  const calls = loraCallsInPrompt(request.prompt)
  if (calls.length > MAX_SDCPP_LORAS) return `At most ${MAX_SDCPP_LORAS} LoRAs in one prompt`
  if (calls.length && !info.features.has('lora')) return 'This backend does not load LoRAs'
  const { found, missing } = resolveLoras(calls, info.loras.map((lora) => lora.name))
  if (missing.length) return `LoRA not found on this backend: ${missing.join(', ')}`
  const pathOf = new Map(info.loras.map((lora) => [loraName(lora.name).toLowerCase(), lora.path]))

  const sampleParams: Record<string, unknown> = {
    sample_steps: request.num_inference_steps,
    guidance: { txt_cfg: request.guidance_scale },
  }
  if (request.sampler && request.sampler !== DEFAULT) sampleParams.sample_method = request.sampler
  if (request.scheduler && request.scheduler !== DEFAULT) sampleParams.scheduler = request.scheduler

  const body: Record<string, unknown> = {
    prompt: withoutLoraCalls(request.prompt),
    negative_prompt: request.negative_prompt,
    width: request.width,
    height: request.height,
    batch_count: 1,
    sample_params: sampleParams,
    lora: found.map(({ file, use }) => ({ path: pathOf.get(loraName(file).toLowerCase()) ?? file, multiplier: use.weight })),
    // Latentry writes its own record; the server's would carry its LoRA paths.
    embed_image_metadata: false,
    preview: previewMode(info),
    preview_interval: 1,
    output_format: 'png',
  }
  const loras = found.map(({ use }) => use)

  if (!request.init_image_base64) {
    let hires = 0
    if (request.hr_scale !== undefined) {
      if (!info.features.has('hires')) return 'Hires fix is not available with the model this backend has loaded'
      hires = request.hr_steps || request.num_inference_steps
      body.hires = {
        enabled: true,
        upscaler: request.hr_upscaler ?? LANCZOS,
        scale: request.hr_scale,
        steps: request.hr_steps ?? 0,
        denoising_strength: request.hr_denoise ?? 0.4,
      }
    }
    return { body, steps: request.num_inference_steps + hires, firstPass: request.num_inference_steps, loras }
  }

  if (!info.features.has('init_image')) return 'A source image is not available with the model this backend has loaded'

  if (request.upscale && request.hr_scale !== undefined) {
    // Upscale: the source enlarged to the exact size (by sharp, or by the
    // server's ESRGAN model), then redrawn at the hires denoise for exactly
    // the hires steps, as on the other backends.
    const size = await imageSize(request.init_image_base64)
    if (!size) return 'Could not read the source image'
    const upscaler = request.hr_upscaler ?? LANCZOS
    const model = info.upscalers.find((item) => item.name === upscaler && item.imageUpscale)
    if (!model && upscaler !== LANCZOS && upscaler !== 'Nearest') return `This upscaler cannot enlarge a picture on its own: ${upscaler}`
    const target = hiresSize(size.width, size.height, request.hr_scale, sizeMultiple)
    const denoise = request.hr_denoise ?? 0.4
    const steps = request.hr_steps || request.num_inference_steps
    body.width = target.width
    body.height = target.height
    body.strength = denoise
    sampleParams.sample_steps = sdcppSchedule(steps, denoise)
    return {
      body,
      enlarge: { source: request.init_image_base64, ...target, model: model ? model.name : null, kernel: upscaler === 'Nearest' ? 'nearest' : 'lanczos3' },
      steps,
      firstPass: steps,
      loras,
    }
  }

  if (request.mask_base64 && !info.features.has('mask_image')) return 'An inpaint mask is not available with the model this backend has loaded'
  const prepared = await preparedImages(request, sizeMultiple)
  if (!prepared) return 'Could not read the source image'
  const strength = request.strength ?? 0.6
  body.width = prepared.width
  body.height = prepared.height
  body.init_image = prepared.source.toString('base64')
  body.strength = strength
  // Its mask is one channel (white = redraw).
  if (prepared.mask) body.mask_image = (await sharp(prepared.mask).toColourspace('b-w').png().toBuffer()).toString('base64')
  const steps = sdcppImg2imgSteps(request.num_inference_steps, strength)
  return { body, steps, firstPass: steps, loras }
}

/**
 * The steps sd-server's img2img runs: the tail of its schedule, rounded up
 * (4 at 0.6 run 3, where the Python pipelines and A1111 truncate to 2).
 * Checked against a real sd-server.
 */
export function sdcppImg2imgSteps(steps: number, strength: number): number {
  return Math.max(1, Math.min(steps, Math.ceil(steps * strength - 1e-6)))
}

/** The step count to ask sd-server's img2img for so that it runs exactly `steps` at `denoise`. */
export function sdcppSchedule(steps: number, denoise: number): number {
  let asked = steps
  while (asked < 1000 && sdcppImg2imgSteps(asked, denoise) < steps) asked += 1
  return asked
}

/** A picture's seed from its generation_info (a decimal string there), when it is a safe integer. */
export function seedOf(item: unknown): number | null {
  const seed = record(record(item).generation_info).seed
  const value = typeof seed === 'string' && /^\d+$/.test(seed) ? Number(seed) : typeof seed === 'number' ? seed : NaN
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}
