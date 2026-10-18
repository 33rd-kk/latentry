// Source images and masks, turned into what a backend that is not
// diffusers-compatible takes: its size, and a mask in its convention.

import sharp from 'sharp'
import { fitToImage } from '@/lib/profiles'
import { stripDataUrl } from './http'

/** Latentry's mask (opaque = redraw) as white (redraw) on black (keep), PNG. */
export async function alphaToMask(maskBase64: string): Promise<Buffer> {
  return sharp(Buffer.from(stripDataUrl(maskBase64), 'base64')).ensureAlpha().extractChannel(3).png().toBuffer()
}

/** The pixel size of a picture, or null when it cannot be read. */
export async function imageSize(base64: string): Promise<{ width: number; height: number } | null> {
  try {
    const meta = await sharp(Buffer.from(stripDataUrl(base64), 'base64')).metadata()
    return meta.width && meta.height ? { width: meta.width, height: meta.height } : null
  } catch {
    return null
  }
}

/**
 * The source (and mask) at the size the run will draw: the requested area,
 * fitted to the source's aspect and the profile's multiple, as the other
 * backends do. The mask is white on black, softened by `maskBlur` pixels.
 * An upscale keeps the source at its own size: the backend enlarges it.
 * Null when the source cannot be read.
 */
export async function preparedImages(
  request: { init_image_base64?: string; mask_base64?: string; mask_blur?: number; width: number; height: number; upscale?: boolean },
  sizeMultiple: number
): Promise<{ width: number; height: number; source: Buffer; mask?: Buffer } | null> {
  if (!request.init_image_base64) return null
  const size = await imageSize(request.init_image_base64)
  if (!size) return null
  const { width, height } = request.upscale ? size : fitToImage(size, request.width, request.height, sizeMultiple)
  try {
    const source = await sharp(Buffer.from(stripDataUrl(request.init_image_base64), 'base64'))
      .resize(width, height, { fit: 'fill' })
      .png()
      .toBuffer()
    if (!request.mask_base64) return { width, height, source }
    const blur = request.mask_blur ?? 4
    let mask = sharp(await alphaToMask(request.mask_base64)).resize(width, height, { fit: 'fill' })
    // sharp's sigma: about half the blur radius, and never below its minimum.
    if (blur > 0) mask = mask.blur(Math.max(0.3, blur / 2))
    return { width, height, source, mask: await mask.png().toBuffer() }
  } catch {
    return null
  }
}

/**
 * A drawn skeleton as a plain RGB PNG at the run's size, without any text
 * chunks it came with. Null when it cannot be read.
 */
export async function preparedSkeleton(base64: string, width: number, height: number): Promise<Buffer | null> {
  try {
    return await sharp(Buffer.from(stripDataUrl(base64), 'base64')).resize(width, height, { fit: 'fill' }).removeAlpha().png().toBuffer()
  } catch {
    return null
  }
}

/** A 1×1 transparent PNG, to overwrite an uploaded picture with nothing. */
export function blankPng(): Promise<Buffer> {
  return sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer()
}
