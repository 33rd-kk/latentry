// SPDX-License-Identifier: MIT
//
// PNG text chunks: reading what other tools wrote, and writing new ones.
//
// A PNG is an 8-byte signature followed by chunks of
//   length (4, big-endian) | type (4 ASCII) | data (length) | CRC-32 (4, over type + data)
// Text lives in three chunk types:
//   tEXt  keyword \0 text                         (Latin-1)
//   zTXt  keyword \0 method \0 deflate(text)       (Latin-1)
//   iTXt  keyword \0 flag method lang \0 key \0 text-or-deflate (UTF-8)
//
// The keywords that matter: A1111 / Forge's `parameters`, ComfyUI's `prompt`,
// and Latentry's own `latentry` (structured settings) and `latentry:tags`
// (WD14 tags written back). New chunks go right after IHDR, where the other
// tools put theirs, so a reader that stops at the first IDAT still finds them.
//
// Part of lib/image-meta: no imports outside node's built-ins (see README.md).

import { crc32, deflateSync, inflateSync } from 'node:zlib'

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export const LATENTRY_KEY = 'latentry'
/**
 * WD14 tags written back from the gallery. A chunk of their own rather than a
 * field of the record, so any PNG in the save folder can carry them — one
 * dropped in from another tool included.
 */
export const TAGS_KEY = 'latentry:tags'
export const PARAMETERS_KEY = 'parameters'

export interface PngChunk {
  type: string
  data: Buffer
}

export function isPng(buffer: Buffer): boolean {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)
}

/** Every chunk in order. Throws on a file that is not a well-formed PNG. */
export function readChunks(png: Buffer): PngChunk[] {
  if (!isPng(png)) throw new Error('Not a PNG')
  const chunks: PngChunk[] = []
  let offset = 8
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.toString('latin1', offset + 4, offset + 8)
    const end = offset + 12 + length
    if (end > png.length) throw new Error(`Truncated ${type} chunk`)
    chunks.push({ type, data: png.subarray(offset + 8, offset + 8 + length) })
    offset = end
    if (type === 'IEND') break
  }
  return chunks
}

/** One chunk as it is written: length, type, data and CRC-32. */
export function encodeChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0)
  return Buffer.concat([head, data, crc])
}

/**
 * The most one compressed text chunk may inflate to. Settings and tags are a
 * few kilobytes, but deflate can grow a small chunk a thousandfold, so a
 * picture someone else made must not decide how much memory reading it takes.
 * A chunk that would inflate past this reads as no text.
 */
export const MAX_TEXT_BYTES = 4 * 1024 * 1024
/** The most text all of one picture's chunks may add up to; the rest is not read. */
export const MAX_TOTAL_TEXT_BYTES = 16 * 1024 * 1024

function inflateText(bytes: Buffer): Buffer {
  return inflateSync(bytes, { maxOutputLength: MAX_TEXT_BYTES })
}

const strictUtf8 = new TextDecoder('utf-8', { fatal: true })

/**
 * A tEXt chunk's text. The format says Latin-1, but some tools (stable-
 * diffusion.cpp among them) write UTF-8 bytes there: bytes above 0x7f that
 * are valid UTF-8 are read as UTF-8, since Latin-1 text almost never is.
 */
function tEXtText(bytes: Buffer): string {
  if (bytes.every((byte) => byte < 0x80)) return bytes.toString('latin1')
  try {
    return strictUtf8.decode(bytes)
  } catch {
    return bytes.toString('latin1')
  }
}

/** The keyword and text of a tEXt, zTXt or iTXt chunk; null for any other chunk or a broken one. */
export function decodeTextChunk(chunk: PngChunk): { keyword: string; text: string } | null {
  const { type, data } = chunk
  if (type !== 'tEXt' && type !== 'zTXt' && type !== 'iTXt') return null
  const nul = data.indexOf(0)
  if (nul <= 0) return null
  const keyword = data.toString('latin1', 0, nul)
  try {
    if (type === 'tEXt') return { keyword, text: tEXtText(data.subarray(nul + 1)) }
    if (type === 'zTXt') return { keyword, text: inflateText(data.subarray(nul + 2)).toString('latin1') }
    // iTXt: compression flag, method, language tag \0, translated keyword \0, text.
    const compressed = data[nul + 1] === 1
    const langEnd = data.indexOf(0, nul + 3)
    if (langEnd === -1) return null
    const translatedEnd = data.indexOf(0, langEnd + 1)
    if (translatedEnd === -1) return null
    const body = data.subarray(translatedEnd + 1)
    return { keyword, text: (compressed ? inflateText(body) : body).toString('utf8') }
  } catch {
    return null
  }
}

/**
 * A picture's text chunks as keyword -> text: the first wins when a keyword
 * repeats, and once MAX_TOTAL_TEXT_BYTES has been kept, nothing more is.
 */
export class TextCollector {
  readonly text: Record<string, string> = {}
  private total = 0

  /** False once the picture's text budget is spent: decode no more chunks. */
  get open(): boolean {
    return this.total < MAX_TOTAL_TEXT_BYTES
  }

  add(decoded: { keyword: string; text: string } | null): void {
    if (!decoded || decoded.keyword in this.text || !this.open) return
    this.total += decoded.text.length
    if (this.total <= MAX_TOTAL_TEXT_BYTES) this.text[decoded.keyword] = decoded.text
  }
}

/** All text chunks as keyword -> text; the first wins when a keyword repeats. */
export function readPngText(png: Buffer): Record<string, string> {
  const collector = new TextCollector()
  for (const chunk of readChunks(png)) {
    if (!collector.open) break
    collector.add(decodeTextChunk(chunk))
  }
  return collector.text
}

function isLatin1(text: string): boolean {
  return /^[\u0000-ÿ]*$/.test(text)
}

/** tEXt when the text fits Latin-1 (what most readers expect), iTXt otherwise. */
export function encodeTextChunk(keyword: string, text: string, options: { compress?: boolean } = {}): Buffer {
  const key = Buffer.from(keyword, 'latin1')
  if (!options.compress && isLatin1(text)) {
    return encodeChunk('tEXt', Buffer.concat([key, Buffer.from([0]), Buffer.from(text, 'latin1')]))
  }
  const body = Buffer.from(text, 'utf8')
  const payload = options.compress ? deflateSync(body) : body
  // keyword \0, compression flag, method 0, empty language \0, empty translated keyword \0
  const header = Buffer.from([0, options.compress ? 1 : 0, 0, 0, 0])
  return encodeChunk('iTXt', Buffer.concat([key, header, payload]))
}

/**
 * The PNG without the text chunks named in `keywords`, whatever their type.
 * The keyword is read from the chunk's head, so a compressed chunk that would
 * not inflate goes too. Every other chunk is kept as it was.
 */
export function removePngText(png: Buffer, keywords: string[]): Buffer {
  const removing = new Set(keywords)
  const parts: Buffer[] = [PNG_SIGNATURE]
  for (const chunk of readChunks(png)) {
    if (chunk.type === 'tEXt' || chunk.type === 'zTXt' || chunk.type === 'iTXt') {
      const nul = chunk.data.indexOf(0)
      if (nul > 0 && removing.has(chunk.data.toString('latin1', 0, nul))) continue
    }
    parts.push(encodeChunk(chunk.type, chunk.data))
  }
  return Buffer.concat(parts)
}

/**
 * The PNG with `entries` written as text chunks right after IHDR. A chunk
 * already carrying one of these keywords is replaced; every other chunk —
 * including other tools' metadata — is kept as it was.
 */
export function writePngText(png: Buffer, entries: Record<string, string>): Buffer {
  const chunks = readChunks(png)
  if (chunks[0]?.type !== 'IHDR') throw new Error('PNG does not start with IHDR')
  const replacing = new Set(Object.keys(entries))
  const parts: Buffer[] = [PNG_SIGNATURE]
  for (const chunk of chunks) {
    // By the keyword in the chunk's head, as removePngText does, so one too
    // big to inflate is replaced too.
    if (chunk.type === 'tEXt' || chunk.type === 'zTXt' || chunk.type === 'iTXt') {
      const nul = chunk.data.indexOf(0)
      if (nul > 0 && replacing.has(chunk.data.toString('latin1', 0, nul))) continue
    }
    parts.push(encodeChunk(chunk.type, chunk.data))
    if (chunk.type === 'IHDR') {
      for (const [keyword, text] of Object.entries(entries)) {
        // Our JSON can be long (tags) and is never meant for a human viewer.
        parts.push(encodeTextChunk(keyword, text, { compress: keyword !== PARAMETERS_KEY && text.length > 2048 }))
      }
    }
  }
  return Buffer.concat(parts)
}

/** IHDR's width and height, or null for a buffer that is not a PNG. */
export function pngSize(png: Buffer): { width: number; height: number } | null {
  if (!isPng(png) || png.length < 24 || png.toString('latin1', 12, 16) !== 'IHDR') return null
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}
