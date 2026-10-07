// SPDX-License-Identifier: MIT
//
// The few EXIF fields that carry generation settings in JPEG and WebP files,
// from a TIFF-structured EXIF block. Not a general EXIF reader: no GPS, no
// maker notes, no thumbnails. That is deliberate, since pictures from a
// camera or phone can carry where they were taken, and this has no reason to
// look.
//
//   UserComment (Exif IFD 0x9286)      A1111 / Forge write their infotext here
//   ImageDescription (IFD0 0x010E)     some tools' prompt text
//   Make (IFD0 0x010F)                 ComfyUI's "Prompt: {graph}" in WebP
//   Model (IFD0 0x0110)                ComfyUI's "Workflow: {graph}" in WebP
//
// Part of lib/image-meta: no imports outside node's built-ins (see README.md).

export interface ExifText {
  userComment?: string
  imageDescription?: string
  make?: string
  model?: string
}

const TAG_IMAGE_DESCRIPTION = 0x010e
const TAG_MAKE = 0x010f
const TAG_MODEL = 0x0110
const TAG_EXIF_IFD = 0x8769
const TAG_USER_COMMENT = 0x9286

const TYPE_SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }
// A whole infotext is a few kilobytes; a graph can be more. Anything larger is not read.
const MAX_VALUE = 4 * 1024 * 1024

/** Drops the "Exif\0\0" prefix that JPEG's APP1 (and some WebP writers) put first. */
export function tiffOf(block: Buffer): Buffer {
  return block.length >= 6 && block.toString('latin1', 0, 6) === 'Exif\0\0' ? block.subarray(6) : block
}

/** The settings-carrying fields of an EXIF block, or null when it is not one. */
export function readExifText(block: Buffer): ExifText | null {
  const tiff = tiffOf(block)
  if (tiff.length < 8) return null
  const order = tiff.toString('latin1', 0, 2)
  if (order !== 'II' && order !== 'MM') return null
  const little = order === 'II'
  const u16 = (at: number) => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at))
  const u32 = (at: number) => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at))
  if (u16(2) !== 42) return null

  /** tag -> the entry's raw value bytes, for one IFD. */
  const readIfd = (offset: number): Map<number, { type: number; value: Buffer }> => {
    const entries = new Map<number, { type: number; value: Buffer }>()
    if (offset < 8 || offset + 2 > tiff.length) return entries
    const count = u16(offset)
    for (let i = 0; i < count; i += 1) {
      const at = offset + 2 + i * 12
      if (at + 12 > tiff.length) break
      const tag = u16(at)
      const type = u16(at + 2)
      const size = (TYPE_SIZES[type] ?? 0) * u32(at + 4)
      if (!size || size > MAX_VALUE) continue
      const start = size <= 4 ? at + 8 : u32(at + 8)
      if (start + size > tiff.length) continue
      entries.set(tag, { type, value: tiff.subarray(start, start + size) })
    }
    return entries
  }

  const ifd0 = readIfd(u32(4))
  const exifPointer = ifd0.get(TAG_EXIF_IFD)
  const exif = exifPointer && exifPointer.value.length >= 4 ? readIfd(little ? exifPointer.value.readUInt32LE(0) : exifPointer.value.readUInt32BE(0)) : new Map()

  const ascii = (tag: number) => {
    const entry = ifd0.get(tag)
    return entry ? decodeAscii(entry.value) : undefined
  }
  const comment = exif.get(TAG_USER_COMMENT)
  return {
    userComment: comment ? decodeUserComment(comment.value) : undefined,
    imageDescription: ascii(TAG_IMAGE_DESCRIPTION),
    make: ascii(TAG_MAKE),
    model: ascii(TAG_MODEL),
  }
}

/** An ASCII field, which in practice is often UTF-8. Trailing NULs dropped. */
function decodeAscii(value: Buffer): string | undefined {
  const text = value.toString('utf8').replace(/\0+$/, '')
  return text || undefined
}

/**
 * UserComment is 8 bytes naming the encoding, then the text. "UNICODE" is
 * UTF-16, and writers disagree on its byte order (piexif, which A1111 uses,
 * writes big-endian whatever the file's order), so it is told from the text:
 * mostly-ASCII text has its zero bytes on one side.
 */
export function decodeUserComment(value: Buffer): string | undefined {
  if (value.length < 8) return undefined
  const code = value.toString('latin1', 0, 8)
  const body = value.subarray(8)
  let text: string
  if (code.startsWith('UNICODE')) {
    const even = body.length - (body.length % 2)
    let zerosHigh = 0
    let zerosLow = 0
    for (let i = 0; i < even; i += 2) {
      if (body[i] === 0) zerosHigh += 1
      if (body[i + 1] === 0) zerosLow += 1
    }
    const bytes = Buffer.from(body.subarray(0, even))
    // Big-endian puts the zero first; utf16le wants it second, so swap.
    if (zerosHigh > zerosLow) bytes.swap16()
    text = bytes.toString('utf16le')
  } else {
    // "ASCII\0\0\0", "\0" * 8 (undefined) and anything else: read as UTF-8.
    text = body.toString('utf8')
  }
  text = text.replace(/\0+$/, '')
  return text.trim() ? text : undefined
}
