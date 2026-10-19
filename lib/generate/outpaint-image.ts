// The server's half of outpainting (see ./outpaint.ts): the source padded to
// its new canvas, and a mask over what is new.

import sharp from 'sharp'
import { stripDataUrl } from '@/lib/backends/http'
import { outpaintCanvas, outpaintFits, OUTPAINT_OVERLAP, type OutpaintSides } from './outpaint'

export interface Outpaint {
  /** The padded source, base64 PNG. */
  image: string
  /** Latentry's mask convention, base64 PNG: opaque over the new area and a strip of the source's edge, transparent elsewhere. */
  mask: string
  width: number
  height: number
}

/**
 * Pads the source by `sides`, stretching its edge pixels outwards so the
 * new area starts from colours that fit, rather than a flat fill. Null when
 * the source cannot be read or the canvas would be too large.
 */
export async function prepareOutpaint(sourceBase64: string, sides: OutpaintSides): Promise<Outpaint | null> {
  let input: Buffer
  let size: { width: number; height: number }
  try {
    input = Buffer.from(stripDataUrl(sourceBase64), 'base64')
    const meta = await sharp(input).metadata()
    if (!meta.width || !meta.height) return null
    size = { width: meta.width, height: meta.height }
  } catch {
    return null
  }
  if (!outpaintFits(size, sides)) return null
  const { width, height, pad } = outpaintCanvas(size, sides)

  const image = await sharp(input)
    // Transparency would come out white on some backends (the engine flattens on white).
    .flatten({ background: '#808080' })
    .extend({ ...pad, extendWith: 'copy' })
    .png()
    .toBuffer()

  // The part of the source that is kept: all of it, less a strip along each side that grows.
  const overlap = (grows: number, across: number) => (grows > 0 ? Math.min(OUTPAINT_OVERLAP, Math.floor(across / 4)) : 0)
  const keepLeft = pad.left + overlap(pad.left, size.width)
  const keepRight = pad.left + size.width - overlap(pad.right, size.width)
  const keepTop = pad.top + overlap(pad.top, size.height)
  const keepBottom = pad.top + size.height - overlap(pad.bottom, size.height)
  const pixels = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    const keptRow = y >= keepTop && y < keepBottom
    for (let x = 0; x < width; x++) {
      if (keptRow && x >= keepLeft && x < keepRight) continue
      pixels[(y * width + x) * 4 + 3] = 255
    }
  }
  const mask = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer()
  return { image: image.toString('base64'), mask: mask.toString('base64'), width, height }
}
