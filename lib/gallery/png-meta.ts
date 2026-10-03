// PNG text chunks: reading what other tools wrote, and writing our own.
//
// A PNG is an 8-byte signature followed by chunks of
//   length (4, big-endian) | type (4 ASCII) | data (length) | CRC-32 (4, over type + data)
// Text lives in three chunk types:
//   tEXt  keyword \0 text                         (Latin-1)
//   zTXt  keyword \0 method \0 deflate(text)       (Latin-1)
//   iTXt  keyword \0 flag method lang \0 key \0 text-or-deflate (UTF-8)
//
// What is read: A1111 / Forge's `parameters`, ComfyUI's `prompt`, and
// Latentry's own `latentry` and `latentry:tags` JSON. What is written: an
// A1111-style `parameters`, which other tools already understand, plus
// `latentry` with everything as structured data, and `latentry:tags` once the
// gallery has WD14-tagged the picture.
//
// New chunks go right after IHDR, where the other tools put theirs, so a reader
// that stops at the first IDAT still finds them.

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

// ── What the text means ─────────────────────────────────────────────────────

export interface ImageTag {
  name: string
  category: number
  score: number
}

/** The settings a picture was made with, whichever tool wrote them. */
export interface ImageMeta {
  source: 'latentry' | 'a1111' | 'comfyui' | 'unknown'
  prompt: string
  negativePrompt: string
  seed?: number
  width?: number
  height?: number
  steps?: number
  cfg?: number
  sampler?: string
  scheduler?: string
  strength?: number
  model?: string
  /** Latentry only: which backend and profile drew it. */
  backend?: string
  kind?: string
  profile?: string
  mode?: string
  /** WD14 tags written back by the gallery. */
  tags?: ImageTag[]
  created?: string
}

/** The JSON stored under the `latentry` keyword. */
export interface LatentryRecord {
  schema: 1
  backend: string
  kind: string
  profile: string
  model: string | null
  mode: string
  prompt: string
  negative_prompt: string
  seed: number
  width: number
  height: number
  sampler: string
  scheduler: string
  steps: number
  cfg: number
  strength?: number
  created: string
}

/**
 * A1111's infotext: the prompt, an optional "Negative prompt:" line, and a
 * last line of "Key: value, Key: value" settings (values may be quoted).
 */
export function parseA1111Parameters(text: string): ImageMeta {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let settingsLine = ''
  if (lines.length && /^Steps: /.test(lines[lines.length - 1].trim())) settingsLine = lines.pop()!.trim()

  const negativeIndex = lines.findIndex((line) => line.startsWith('Negative prompt:'))
  const prompt = (negativeIndex === -1 ? lines : lines.slice(0, negativeIndex)).join('\n').trim()
  const negativePrompt =
    negativeIndex === -1
      ? ''
      : [lines[negativeIndex].slice('Negative prompt:'.length), ...lines.slice(negativeIndex + 1)].join('\n').trim()

  const settings: Record<string, string> = {}
  const pattern = /\s*([^:,]+):\s*("(?:\\.|[^\\"])*"|[^,]*)(?:,|$)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(settingsLine)) && match[0]) {
    let value = match[2].trim()
    if (value.startsWith('"')) {
      try {
        value = JSON.parse(value)
      } catch {
        // keep it quoted
      }
    }
    settings[match[1].trim()] = value
  }

  const num = (key: string) => {
    const value = Number(settings[key])
    return settings[key] !== undefined && Number.isFinite(value) ? value : undefined
  }
  const size = /^(\d+)x(\d+)$/.exec(settings.Size ?? '')
  return {
    source: 'a1111',
    prompt,
    negativePrompt,
    seed: num('Seed'),
    steps: num('Steps'),
    cfg: num('CFG scale'),
    sampler: settings.Sampler,
    scheduler: settings['Schedule type'],
    strength: num('Denoising strength'),
    model: settings.Model,
    ...(size ? { width: Number(size[1]), height: Number(size[2]) } : {}),
  }
}

/** Writes the A1111 infotext for a record, so other tools can read our files. */
export function formatA1111Parameters(record: LatentryRecord): string {
  const settings: string[] = [
    `Steps: ${record.steps}`,
    `Sampler: ${record.sampler}`,
    ...(record.scheduler && record.scheduler !== 'Default' ? [`Schedule type: ${record.scheduler}`] : []),
    `CFG scale: ${record.cfg}`,
    `Seed: ${record.seed}`,
    `Size: ${record.width}x${record.height}`,
    ...(record.model ? [`Model: ${quoteIfNeeded(record.model)}`] : []),
    ...(record.strength !== undefined ? [`Denoising strength: ${record.strength}`] : []),
    `Version: Latentry (${record.backend})`,
  ]
  const lines = [record.prompt]
  if (record.negative_prompt) lines.push(`Negative prompt: ${record.negative_prompt}`)
  lines.push(settings.join(', '))
  return lines.join('\n')
}

function quoteIfNeeded(value: string): string {
  return /[,:"]/.test(value) ? JSON.stringify(value) : value
}

type ComfyNode = { class_type?: unknown; inputs?: Record<string, unknown> }

/**
 * ComfyUI's `prompt` chunk is the executed graph: node id -> { class_type, inputs },
 * with links as [node id, output index]. The sampler's `positive` / `negative`
 * links lead to the text encoders, which is how the two prompts are told apart.
 */
export function parseComfyPrompt(text: string): ImageMeta | null {
  let graph: Record<string, ComfyNode>
  try {
    graph = JSON.parse(text)
  } catch {
    return null
  }
  if (!graph || typeof graph !== 'object') return null

  const nodes = Object.values(graph)
  const sampler = nodes.find((node) => typeof node?.class_type === 'string' && /KSampler/.test(node.class_type))
  const textOf = (link: unknown, depth = 0): string => {
    if (!Array.isArray(link) || depth > 4) return ''
    const node = graph[String(link[0])]
    const inputs = node?.inputs ?? {}
    for (const key of ['text', 'text_g', 'prompt']) {
      if (typeof inputs[key] === 'string') return inputs[key] as string
      if (Array.isArray(inputs[key])) return textOf(inputs[key], depth + 1)
    }
    // A conditioning passthrough (e.g. a combine node): follow its first link.
    const next = Object.values(inputs).find(Array.isArray)
    return next ? textOf(next, depth + 1) : ''
  }

  const inputs = sampler?.inputs ?? {}
  const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
  const checkpoint = nodes.find((node) => node?.class_type === 'CheckpointLoaderSimple')?.inputs?.ckpt_name
  const latent = Array.isArray(inputs.latent_image) ? graph[String(inputs.latent_image[0])]?.inputs : undefined

  const prompt = textOf(inputs.positive)
  if (!prompt && !sampler) return null
  return {
    source: 'comfyui',
    prompt,
    negativePrompt: textOf(inputs.negative),
    seed: num(inputs.seed) ?? num(inputs.noise_seed),
    steps: num(inputs.steps),
    cfg: num(inputs.cfg),
    sampler: typeof inputs.sampler_name === 'string' ? inputs.sampler_name : undefined,
    scheduler: typeof inputs.scheduler === 'string' ? inputs.scheduler : undefined,
    strength: num(inputs.denoise) !== undefined && num(inputs.denoise)! < 1 ? num(inputs.denoise) : undefined,
    model: typeof checkpoint === 'string' ? checkpoint : undefined,
    width: num(latent?.width),
    height: num(latent?.height),
  }
}

function isTagList(value: unknown): value is ImageTag[] {
  return (
    Array.isArray(value) &&
    value.every((tag) => typeof tag?.name === 'string' && typeof tag?.score === 'number' && typeof tag?.category === 'number')
  )
}

export function parseLatentryRecord(text: string): ImageMeta | null {
  let record: Partial<LatentryRecord>
  try {
    record = JSON.parse(text)
  } catch {
    return null
  }
  if (!record || record.schema !== 1 || typeof record.prompt !== 'string') return null
  const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
  const str = (value: unknown) => (typeof value === 'string' && value ? value : undefined)
  return {
    source: 'latentry',
    prompt: record.prompt,
    negativePrompt: typeof record.negative_prompt === 'string' ? record.negative_prompt : '',
    seed: num(record.seed),
    width: num(record.width),
    height: num(record.height),
    steps: num(record.steps),
    cfg: num(record.cfg),
    sampler: str(record.sampler),
    scheduler: str(record.scheduler),
    strength: num(record.strength),
    model: str(record.model),
    backend: str(record.backend),
    kind: str(record.kind),
    profile: str(record.profile),
    mode: str(record.mode),
    created: str(record.created),
  }
}

export function parseTags(text: string | undefined): ImageTag[] | null {
  if (!text) return null
  try {
    const value = JSON.parse(text)
    return isTagList(value) ? value : null
  } catch {
    return null
  }
}

/**
 * The settings in a picture's text chunks, preferring the most structured
 * source: our own record, then A1111's infotext, then ComfyUI's graph. WD14
 * tags written back by the gallery join whichever source supplies the rest.
 */
export function metaFromText(text: Record<string, string>): ImageMeta | null {
  const tags = parseTags(text[TAGS_KEY])
  const meta =
    (text[LATENTRY_KEY] ? parseLatentryRecord(text[LATENTRY_KEY]) : null) ??
    (text[PARAMETERS_KEY] ? parseA1111Parameters(text[PARAMETERS_KEY]) : null) ??
    (text.prompt ? parseComfyPrompt(text.prompt) : null)
  if (!meta && !tags) return null
  return { ...(meta ?? { source: 'unknown', prompt: '', negativePrompt: '' }), ...(tags ? { tags } : {}) }
}
