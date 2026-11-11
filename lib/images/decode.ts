// Decoding pictures that came from outside: a source, mask or picture to
// tag sent by a paired device, or a result sent back by a backend.
//
// sharp decodes up to about 268 million pixels by default, which as RGBA is
// a gigabyte, and a request may carry a picture of up to 48 MB. A few at
// once could take a home computer's memory. Nothing Latentry makes is that
// large: the browser shrinks a source to 2048 pixels on its long side, and a
// hires fix ends at 4096. MAX_INPUT_PIXELS leaves room for a 4x upscale of
// a 2048 picture and refuses anything larger before it is decoded.
//
// Pictures in the gallery folders (thumbnails, sheets) are not decoded
// through here: they are files the owner chose to show, and may be larger.

import sharp, { type SharpOptions } from 'sharp'

export const MAX_INPUT_PIXELS = 8192 * 8192

/** sharp for a picture from outside: one larger than MAX_INPUT_PIXELS throws when it is decoded. */
export function decodeImage(input: Buffer, options: Omit<SharpOptions, 'limitInputPixels'> = {}): ReturnType<typeof sharp> {
  return sharp(input, { ...options, limitInputPixels: MAX_INPUT_PIXELS })
}

/** Whether a picture of this size may be decoded; for checking a header's size before decoding. */
export function fitsDecode(size: { width?: number; height?: number }): boolean {
  return !!size.width && !!size.height && size.width * size.height <= MAX_INPUT_PIXELS
}
