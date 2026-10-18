// Latentry's request in the A1111 web UI's field names, and the seeds out of
// its answer. Used by ./a1111.ts.

import { hiresSchedule, hiresSize, LANCZOS } from '@/lib/diffusion/hires'
import { fitToImage } from '@/lib/profiles'
import { alphaToMask, imageSize } from './images'
import { stripDataUrl } from './http'
import type { GenerateRequest } from './types'

/** The choice that leaves the sampler or scheduler to the web UI. */
export const DEFAULT = 'Default'

/** Where an A1111 run goes and with what; `extras` is an upscale's first call (POST /sdapi/v1/extra-single-image). */
export interface A1111Payload {
  path: string
  body: Record<string, unknown>
  extras?: Record<string, unknown>
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
 * Our request in the web UI's field names; `null` when the source cannot be
 * read. An upscale also carries `extras`, the call that enlarges the source:
 * its picture goes into `body.init_images` before `path` is called.
 */
export async function toA1111Payload(
  request: GenerateRequest,
  sizeMultiple: number
): Promise<A1111Payload | null> {
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

  if (!request.init_image_base64) {
    if (request.hr_scale !== undefined) {
      body.enable_hr = true
      body.hr_scale = request.hr_scale
      body.hr_upscaler = request.hr_upscaler ?? LANCZOS
      // 0 is the web UI's own "as many as the first pass".
      body.hr_second_pass_steps = request.hr_steps ?? 0
      body.denoising_strength = request.hr_denoise ?? 0.4
      // Forge and its forks fail the second pass ("'NoneType' object is not
      // iterable") without this; A1111 drops fields it does not know.
      body.hr_additional_modules = ['Use same choices']
      // Their API's own hires CFG is 1, which smears the redraw; the first pass's, as their UI does.
      body.hr_cfg = request.guidance_scale
    }
    return { path: '/sdapi/v1/txt2img', body }
  }

  const size = await imageSize(request.init_image_base64)
  if (!size) return null
  if (request.upscale && request.hr_scale !== undefined) {
    // Upscale: the extras tab enlarges the source with the chosen upscaler to
    // the exact size, then img2img redraws that at the hires denoise. Its
    // schedule is long enough to run exactly the hires steps.
    const target = hiresSize(size.width, size.height, request.hr_scale, sizeMultiple)
    const denoise = request.hr_denoise ?? 0.4
    body.width = target.width
    body.height = target.height
    body.steps = hiresSchedule(request.hr_steps || request.num_inference_steps, denoise)
    body.denoising_strength = denoise
    body.resize_mode = 0
    const extras = {
      image: stripDataUrl(request.init_image_base64),
      // 1: to this width and height, not by a factor.
      resize_mode: 1,
      upscaling_resize_w: target.width,
      upscaling_resize_h: target.height,
      upscaling_crop: false,
      upscaler_1: request.hr_upscaler ?? LANCZOS,
      show_extras_results: true,
    }
    return { path: '/sdapi/v1/img2img', body, extras }
  }
  // Fit the output to the source's aspect, as the diffusers-compatible API
  // does server-side; the web UI would otherwise stretch it.
  const fitted = fitToImage(size, request.width, request.height, sizeMultiple)
  body.width = fitted.width
  body.height = fitted.height
  body.init_images = [stripDataUrl(request.init_image_base64)]
  body.denoising_strength = request.strength ?? 0.6
  body.resize_mode = 0
  if (request.mask_base64) {
    body.mask = (await alphaToMask(request.mask_base64)).toString('base64')
    body.mask_blur = request.mask_blur ?? 4
    // 1 = start from the source's own pixels under the mask.
    body.inpainting_fill = 1
    body.inpaint_full_res = false
    body.inpainting_mask_invert = 0
  }
  return { path: '/sdapi/v1/img2img', body }
}
