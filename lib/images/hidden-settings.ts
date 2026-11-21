// Settings hidden in a PNG's pixels, taken out of a copy shared "without
// settings".
//
// Taking the text chunks out (lib/image-meta/strip.ts) leaves the pixels as
// they are, but some tools hide a second copy of the settings in them:
// NovelAI writes it into the lowest bit of each pixel's alpha, column by
// column, after a magic word ("stealth_pnginfo", or "stealth_pngcomp" when
// gzipped); the web UI's stealth extension can also use the lowest bit of
// red, green and blue ("stealth_rgbinfo" / "stealth_rgbcomp").
//
// Only a PNG with 8-bit channels is looked at, and only one whose first bits
// spell such a word is changed: those lowest bits are set to one value (alpha
// to 1, so an opaque picture stays opaque; colours to 0), which moves no
// value by more than 1 in 255, and the picture is written again as a PNG,
// losslessly. Any other picture comes back as the same bytes. Nothing hidden
// is read or kept: the word is only recognised.

import sharp from 'sharp'
import { stripMetadata } from '@/lib/image-meta'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const ALPHA_WORDS = ['stealth_pnginfo', 'stealth_pngcomp']
const RGB_WORDS = ['stealth_rgbinfo', 'stealth_rgbcomp']
const WORD_BITS = 'stealth_pnginfo'.length * 8

/** The PNG's colour type and bit depth from its IHDR, or null when it is not a PNG. */
function pngHeader(png: Buffer): { colourType: number; bitDepth: number } | null {
  if (png.length < 33 || !png.subarray(0, 8).equals(PNG_SIGNATURE) || png.toString('latin1', 12, 16) !== 'IHDR') return null
  return { bitDepth: png[24], colourType: png[25] }
}

/** The text spelled by `count` bits, each the lowest bit of the value `at(i)` gives for bit i. */
function spelled(count: number, at: (i: number) => number): string {
  const bytes = Buffer.alloc(Math.ceil(count / 8))
  for (let i = 0; i < count; i += 1) bytes[i >> 3] |= (at(i) & 1) << (7 - (i & 7))
  return bytes.toString('latin1')
}

export type HiddenKind = 'alpha' | 'rgb'

/**
 * Which hidden copy a decoded picture carries, if any. `data` is raw pixels,
 * `channels` per pixel, read column by column as the hiding tools write them.
 */
export function hiddenKindIn(data: Uint8Array, width: number, height: number, channels: number): HiddenKind | null {
  const pixels = width * height
  // Column by column: bit i is the pixel at (x = i div height, y = i mod height).
  const offset = (pixel: number) => ((pixel % height) * width + Math.floor(pixel / height)) * channels
  if ((channels === 4 || channels === 2) && pixels >= WORD_BITS) {
    const word = spelled(WORD_BITS, (i) => data[offset(i) + channels - 1])
    if (ALPHA_WORDS.includes(word)) return 'alpha'
  }
  if (channels >= 3 && pixels * 3 >= WORD_BITS) {
    const word = spelled(WORD_BITS, (i) => data[offset(Math.floor(i / 3)) + (i % 3)])
    if (RGB_WORDS.includes(word)) return 'rgb'
  }
  return null
}

/**
 * The PNG without a copy of its settings hidden in its pixels; the same
 * bytes when it has none, or is not a PNG this can look into. Throws when
 * the picture cannot be decoded, so a copy is never shared unchecked.
 */
export async function withoutHiddenSettings(png: Buffer): Promise<Buffer> {
  const header = pngHeader(png)
  // Palette and 16-bit pictures: the tools write 8-bit RGB or RGBA only.
  if (!header || header.bitDepth !== 8 || header.colourType === 3) return png
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  const kind = hiddenKindIn(data, info.width, info.height, info.channels)
  if (!kind) return png
  if (kind === 'alpha') {
    for (let at = info.channels - 1; at < data.length; at += info.channels) data[at] |= 1
  } else {
    const colours = Math.min(3, info.channels)
    for (let at = 0; at < data.length; at += info.channels) for (let c = 0; c < colours; c += 1) data[at + c] &= 0xfe
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).png({ compressionLevel: 9 }).toBuffer()
}

/**
 * A picture's copy for sharing without settings: no hidden copy in its pixels
 * and no metadata blocks. Null when that cannot be made (a format it cannot
 * clean, or a PNG it could not look into), so nothing goes out unchecked.
 */
export async function cleanCopy(bytes: Buffer): Promise<Buffer | null> {
  try {
    return stripMetadata(await withoutHiddenSettings(bytes))
  } catch (error) {
    console.error('Could not check a picture for hidden settings:', error instanceof Error ? error.message : error)
    return null
  }
}
