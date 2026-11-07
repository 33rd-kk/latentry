// SPDX-License-Identifier: MIT
//
// A picture's size and settings text, read from the file's structure
// without loading the image: chunk and segment headers are read, and pixel
// data is skipped over. Works for PNG, JPEG and WebP.
//
// The text comes back keyed the way PNG keys it, so metaFromText reads all
// three formats alike: EXIF UserComment (where A1111 / Forge save their
// infotext in JPEG and WebP) becomes `parameters`, and ComfyUI's WebP
// "Prompt: {graph}" becomes `prompt`. stable-diffusion.cpp keeps its
// `parameters` text in a JPEG comment (`parameters`, NUL, the text) and in a
// WebP's XMP (`<sdcpp:parameters>`); both become `parameters` too.
//
// Part of lib/image-meta: no imports outside node's built-ins (see README.md).

import { open, type FileHandle } from 'node:fs/promises'
import { readExifText, type ExifText } from './exif'
import { decodeTextChunk, PNG_SIGNATURE } from './png'

export type ImageFormat = 'png' | 'jpeg' | 'webp'

export interface ImageInfo {
  format: ImageFormat
  /** 0 when the header could not be read. */
  width: number
  height: number
  /** keyword -> text, PNG-style (see above). */
  text: Record<string, string>
}

// Text and EXIF blocks are small; anything claiming more is not read.
const MAX_BLOCK = 8 * 1024 * 1024

type Reader = (length: number, at: number) => Promise<Buffer>

/** The picture's format, size and settings text; null for a file that is none of the three. */
export async function readImageInfo(file: string): Promise<ImageInfo | null> {
  const handle = await open(file, 'r')
  try {
    return await readImageInfoFrom(handle)
  } finally {
    await handle.close()
  }
}

/** As readImageInfo, through a handle the caller opened (and closes). */
export async function readImageInfoFrom(handle: FileHandle): Promise<ImageInfo | null> {
  const size = (await handle.stat()).size
  const read: Reader = async (length, at) => {
    const buffer = Buffer.alloc(Math.max(0, Math.min(length, size - at)))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, at)
    return buffer.subarray(0, bytesRead)
  }
  const head = await read(12, 0)
  if (head.length >= 8 && head.subarray(0, 8).equals(PNG_SIGNATURE)) return readPng(read)
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return readJpeg(read, size)
  if (head.length >= 12 && head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP') return readWebp(read, size)
  return null
}

/** PNG: IHDR for the size, every text chunk; IDAT is skipped by its length. */
async function readPng(read: Reader): Promise<ImageInfo> {
  let position = 8
  let width = 0
  let height = 0
  const text: Record<string, string> = {}
  while (true) {
    const chunkHead = await read(8, position)
    if (chunkHead.length < 8) break
    const length = chunkHead.readUInt32BE(0)
    const type = chunkHead.toString('latin1', 4, 8)
    const dataAt = position + 8
    if (type === 'IHDR' && length >= 8) {
      const ihdr = await read(8, dataAt)
      if (ihdr.length === 8) {
        width = ihdr.readUInt32BE(0)
        height = ihdr.readUInt32BE(4)
      }
    } else if ((type === 'tEXt' || type === 'zTXt' || type === 'iTXt') && length <= MAX_BLOCK) {
      const decoded = decodeTextChunk({ type, data: await read(length, dataAt) })
      if (decoded && !(decoded.keyword in text)) text[decoded.keyword] = decoded.text
    } else if (type === 'IEND') {
      break
    }
    position = dataAt + length + 4
  }
  return { format: 'png', width, height, text }
}

/**
 * JPEG: segments from the start up to the scan. SOFn gives the size, APP1
 * "Exif" the settings. Nothing after the start of scan is read.
 */
async function readJpeg(read: Reader, size: number): Promise<ImageInfo> {
  let position = 2
  let width = 0
  let height = 0
  let exif: ExifText | null = null
  let comment: string | null = null
  while (position + 4 <= size) {
    const head = await read(4, position)
    if (head.length < 4 || head[0] !== 0xff) break
    const marker = head[1]
    // Fill bytes, and markers that stand alone without a length.
    if (marker === 0xff) {
      position += 1
      continue
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      position += 2
      continue
    }
    if (marker === 0xd9 || marker === 0xda) break
    const length = head.readUInt16BE(2)
    if (length < 2) break
    const dataAt = position + 4
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isFrame && length >= 7) {
      const frame = await read(5, dataAt)
      if (frame.length === 5) {
        height = frame.readUInt16BE(1)
        width = frame.readUInt16BE(3)
      }
    } else if (marker === 0xe1 && !exif) {
      const data = await read(length - 2, dataAt)
      if (data.toString('latin1', 0, 6) === 'Exif\0\0') exif = readExifText(data)
    } else if (marker === 0xfe && comment === null) {
      comment = parametersComment(await read(length - 2, dataAt))
    }
    position += 2 + length
  }
  return { format: 'jpeg', width, height, text: withParameters(textFromExif(exif), comment) }
}

/**
 * WebP: RIFF chunks. VP8X (extended), VP8 (lossy) or VP8L (lossless) give
 * the size; EXIF the settings. Image data chunks are skipped by length.
 */
async function readWebp(read: Reader, size: number): Promise<ImageInfo> {
  let position = 12
  let width = 0
  let height = 0
  let exif: ExifText | null = null
  let xmp: string | null = null
  while (position + 8 <= size) {
    const head = await read(8, position)
    if (head.length < 8) break
    const fourcc = head.toString('latin1', 0, 4)
    const length = head.readUInt32LE(4)
    const dataAt = position + 8
    if (fourcc === 'VP8X' && length >= 10) {
      const b = await read(10, dataAt)
      if (b.length === 10) {
        width = 1 + (b[4] | (b[5] << 8) | (b[6] << 16))
        height = 1 + (b[7] | (b[8] << 8) | (b[9] << 16))
      }
    } else if (fourcc === 'VP8 ' && !width && length >= 10) {
      const b = await read(10, dataAt)
      if (b.length === 10 && b[3] === 0x9d && b[4] === 0x01 && b[5] === 0x2a) {
        width = b.readUInt16LE(6) & 0x3fff
        height = b.readUInt16LE(8) & 0x3fff
      }
    } else if (fourcc === 'VP8L' && !width && length >= 5) {
      const b = await read(5, dataAt)
      if (b.length === 5 && b[0] === 0x2f) {
        const bits = b.readUInt32LE(1)
        width = (bits & 0x3fff) + 1
        height = ((bits >>> 14) & 0x3fff) + 1
      }
    } else if (fourcc === 'EXIF' && length <= MAX_BLOCK && !exif) {
      exif = readExifText(await read(length, dataAt))
    } else if (fourcc === 'XMP ' && length <= MAX_BLOCK && xmp === null) {
      xmp = sdcppXmpParameters((await read(length, dataAt)).toString('utf8'))
    }
    // Chunks are padded to an even length.
    position = dataAt + length + (length % 2)
  }
  return { format: 'webp', width, height, text: withParameters(textFromExif(exif), xmp) }
}

/** The text with `parameters` from another block, when EXIF gave none. */
function withParameters(text: Record<string, string>, parameters: string | null): Record<string, string> {
  if (parameters && !text.parameters) text.parameters = parameters
  return text
}

const COMMENT_LABEL = 'parameters\0'

/** stable-diffusion.cpp's JPEG comment (`parameters`, NUL, the text, NUL) as text; null for any other comment. */
export function parametersComment(data: Buffer): string | null {
  if (data.toString('latin1', 0, COMMENT_LABEL.length) !== COMMENT_LABEL) return null
  let end = data.length
  while (end > COMMENT_LABEL.length && data[end - 1] === 0) end -= 1
  return data.toString('utf8', COMMENT_LABEL.length, end) || null
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/**
 * The `<sdcpp:parameters>` element of stable-diffusion.cpp's XMP, unescaped;
 * null when there is none. Only that element is read: no other XMP field is
 * taken, and no XML parser runs on the file.
 */
export function sdcppXmpParameters(xmp: string): string | null {
  const match = /<sdcpp:parameters>([\s\S]*?)<\/sdcpp:parameters>/.exec(xmp)
  if (!match) return null
  const text = match[1].replace(/&(?:(amp|lt|gt|quot|apos)|#(\d{1,7})|#x([0-9a-fA-F]{1,6}));/g, (whole, name?: string, dec?: string, hex?: string) => {
    if (name) return XML_ENTITIES[name]
    const code = dec ? Number(dec) : Number.parseInt(hex ?? '', 16)
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
  })
  return text || null
}

/** EXIF fields under the keywords a PNG would use for the same thing. */
function textFromExif(exif: ExifText | null): Record<string, string> {
  const text: Record<string, string> = {}
  if (!exif) return text
  const infotext = exif.userComment ?? (exif.imageDescription && /\nSteps: /.test(exif.imageDescription) ? exif.imageDescription : undefined)
  if (infotext) text.parameters = infotext
  // ComfyUI's WebP: "Prompt: {graph}" in Make, "Workflow: {graph}" in Model.
  for (const field of [exif.make, exif.model]) {
    const match = field && /^(prompt|workflow):\s*([\s\S]*)$/i.exec(field)
    if (match) text[match[1].toLowerCase()] ??= match[2]
  }
  return text
}
