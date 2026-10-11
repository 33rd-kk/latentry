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

function encodeChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0)
  return Buffer.concat([head, data, crc])
}

/** The keyword and text of a tEXt, zTXt or iTXt chunk; null for any other chunk or a broken one. */
export function decodeTextChunk(chunk: PngChunk): { keyword: string; text: string } | null {
  const { type, data } = chunk
  if (type !== 'tEXt' && type !== 'zTXt' && type !== 'iTXt') return null
  const nul = data.indexOf(0)
  if (nul <= 0) return null
  const keyword = data.toString('latin1', 0, nul)
  try {
    if (type === 'tEXt') return { keyword, text: data.toString('latin1', nul + 1) }
    if (type === 'zTXt') return { keyword, text: inflateSync(data.subarray(nul + 2)).toString('latin1') }
    // iTXt: compression flag, method, language tag \0, translated keyword \0, text.
    const compressed = data[nul + 1] === 1
    const langEnd = data.indexOf(0, nul + 3)
    if (langEnd === -1) return null
    const translatedEnd = data.indexOf(0, langEnd + 1)
    if (translatedEnd === -1) return null
    const body = data.subarray(translatedEnd + 1)
    return { keyword, text: (compressed ? inflateSync(body) : body).toString('utf8') }
  } catch {
    return null
  }
}

/** All text chunks as keyword -> text; the first wins when a keyword repeats. */
export function readPngText(png: Buffer): Record<string, string> {
  const result: Record<string, string> = {}
  for (const chunk of readChunks(png)) {
    const decoded = decodeTextChunk(chunk)
    if (decoded && !(decoded.keyword in result)) result[decoded.keyword] = decoded.text
  }
  return result
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
    const decoded = decodeTextChunk(chunk)
    if (decoded && replacing.has(decoded.keyword)) continue
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
