// Face fix's pictures: the square crop around each face, the mask that says
// what of it is redrawn, and pasting the redrawn crop back. The crop is sent
// as an ordinary inpaint, larger than it sits in the picture, so a small
// face gets the backend's full resolution; only the masked part is pasted
// back, through the same soft edge, so nothing else of the picture changes.

import sharp from 'sharp'
import type { FaceBox } from './decode'

/** A square in the picture's pixels, and where the face sits in it. */
export interface FaceCrop {
  left: number
  top: number
  size: number
  face: FaceBox
}

/** The crop's side as a multiple of the face's larger side: room for hair, chin and some background. */
const CROP_GROW = 1.8
/** The mask's ellipse as a multiple of the face box, so a jaw or fringe is not cut through. */
const MASK_GROW = { x: 1.1, y: 1.2 }
/** The share of the ellipse's radius over which the mask fades out. */
const FEATHER = 0.3

/** The square crop around a face, kept inside the picture (moved, not cut, while the picture is large enough). */
export function cropFor(face: FaceBox, width: number, height: number): FaceCrop {
  const side = Math.round(Math.max(face.width, face.height) * CROP_GROW)
  const size = Math.max(8, Math.min(side, width, height))
  const centreX = face.x + face.width / 2
  const centreY = face.y + face.height / 2
  const left = Math.round(Math.min(Math.max(0, centreX - size / 2), width - size))
  const top = Math.round(Math.min(Math.max(0, centreY - size / 2), height - size))
  return { left, top, size, face }
}

/** How much of each crop pixel is redrawn, 0–1, row by row: a soft ellipse around the face. */
export function maskWeights(crop: FaceCrop): Float32Array {
  const weights = new Float32Array(crop.size * crop.size)
  const cx = crop.face.x + crop.face.width / 2 - crop.left
  const cy = crop.face.y + crop.face.height / 2 - crop.top
  const rx = Math.max(1, (crop.face.width / 2) * MASK_GROW.x)
  const ry = Math.max(1, (crop.face.height / 2) * MASK_GROW.y)
  for (let y = 0; y < crop.size; y += 1) {
    for (let x = 0; x < crop.size; x += 1) {
      const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry)
      // 1 inside, 0 outside, a smooth step across the feather.
      const t = Math.min(1, Math.max(0, (1 - d) / FEATHER))
      weights[y * crop.size + x] = t * t * (3 - 2 * t)
    }
  }
  return weights
}

/** The mask as the backends take it: a PNG whose opaque pixels are redrawn. */
export async function maskPng(crop: FaceCrop): Promise<string> {
  const weights = maskWeights(crop)
  const rgba = Buffer.alloc(crop.size * crop.size * 4)
  for (let index = 0; index < weights.length; index += 1) {
    rgba[index * 4] = 255
    rgba[index * 4 + 1] = 255
    rgba[index * 4 + 2] = 255
    rgba[index * 4 + 3] = Math.round(weights[index] * 255)
  }
  return (await sharp(rgba, { raw: { width: crop.size, height: crop.size, channels: 4 } }).png().toBuffer()).toString('base64')
}

/** A picture held as RGBA pixels while its faces are pasted in. */
export interface Canvas {
  width: number
  height: number
  rgba: Buffer
}

export async function canvasOf(base64: string): Promise<Canvas> {
  const { data, info } = await sharp(Buffer.from(base64, 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, rgba: data }
}

/** The crop of the canvas as it stands, as a PNG (base64): faces fixed earlier show in later crops. */
export async function cropPng(canvas: Canvas, crop: FaceCrop): Promise<string> {
  return (
    await sharp(canvas.rgba, { raw: { width: canvas.width, height: canvas.height, channels: 4 } })
      .extract({ left: crop.left, top: crop.top, width: crop.size, height: crop.size })
      .png()
      .toBuffer()
  ).toString('base64')
}

/** Pastes a redrawn crop (any size; scaled back to the crop's) into the canvas through the crop's mask. */
export async function pasteFace(canvas: Canvas, crop: FaceCrop, redrawnBase64: string): Promise<void> {
  const redrawn = await sharp(Buffer.from(redrawnBase64, 'base64')).resize(crop.size, crop.size, { fit: 'fill', kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer()
  const weights = maskWeights(crop)
  for (let y = 0; y < crop.size; y += 1) {
    for (let x = 0; x < crop.size; x += 1) {
      const weight = weights[y * crop.size + x]
      if (weight === 0) continue
      const at = ((crop.top + y) * canvas.width + crop.left + x) * 4
      const from = (y * crop.size + x) * 4
      for (let channel = 0; channel < 3; channel += 1) {
        canvas.rgba[at + channel] = Math.round(canvas.rgba[at + channel] * (1 - weight) + redrawn[from + channel] * weight)
      }
    }
  }
}

export async function canvasPng(canvas: Canvas): Promise<string> {
  return (await sharp(canvas.rgba, { raw: { width: canvas.width, height: canvas.height, channels: 4 } }).png().toBuffer()).toString('base64')
}
