// What the user keeps about each checkpoint: where it came from and the
// settings its page recommends, to put on the generate form in one click.
//
// Its own file next to the settings file (latentry.models.json), not a part of
// the settings: it is the user's notes, not how Latentry runs. Owner-only, like
// the settings file, since model names and links say what is on this computer.
// The link is only kept and shown; Latentry never fetches it.
//
// Server-side only. The checks are pure, so the verify script can pin them down.

import { randomBytes } from 'node:crypto'
import { closeSync, fstatSync, openSync, readFileSync } from 'node:fs'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { HIRES_LIMITS } from '@/lib/diffusion/hires'
import { restrictExistingToOwner, restrictToOwner } from '@/lib/security/owner-only'
import { settingsPath } from '@/lib/settings/store'

type Env = Record<string, string | undefined>

export const MODEL_INFO_VERSION = 1
export const MAX_MODEL_INFO_ENTRIES = 1000
const MAX_NAME_LENGTH = 200
const MAX_TEXT_LENGTH = 2000
const MAX_OPTION_LENGTH = 200

export interface ModelInfo {
  /** The checkpoint's file name as the backend reports it, for display. */
  name: string
  url?: string
  notes?: string
  sampler?: string
  scheduler?: string
  steps?: number
  cfg?: number
  width?: number
  height?: number
  negativePrompt?: string
  hires?: { scale: number; steps: number; denoise: number; upscaler: string }
  /** When it was last saved, in ms since the epoch. */
  updatedAt: number
}

/** Field path → i18n key, as validateSettings reports them. */
export type ModelInfoErrors = Record<string, string>

/**
 * The checkpoint's file name, without any folder ("sdxl\x.safetensors") or
 * the hash A1111 adds ("x.safetensors [abc123]"), so the engine, ComfyUI and
 * A1111 name the same file alike. Null for anything that is not a file name.
 */
export function modelName(raw: unknown): string | null {
  // Bounded before any pattern runs: A1111's whole path, at most, plus its hash.
  if (typeof raw !== 'string' || raw.length > MAX_RAW_NAME_LENGTH) return null
  let name = (raw.trim().split(/[\\/]/).pop() ?? '').trim()
  const hash = name.lastIndexOf(' [')
  if (hash > 0 && /^\[[0-9a-f]+\]$/i.test(name.slice(hash + 1))) name = name.slice(0, hash).trim()
  if (!name || name.length > MAX_NAME_LENGTH || name === '.' || name === '..' || RESERVED.has(name.toLowerCase()) || /[\u0000-\u001f\u007f]/.test(name)) return null
  return name
}

const MAX_RAW_NAME_LENGTH = 1024
// Names an object already has: never a key, so no lookup or write reaches its prototype.
const RESERVED = new Set(['__proto__', 'constructor', 'prototype'])

/** The name a model's info is kept under: case does not tell two files apart on Windows. */
export function modelKey(raw: unknown): string | null {
  return modelName(raw)?.toLowerCase() ?? null
}

const CONTROL = /[\u0000-\u001f\u007f]/
// Notes may span lines; nothing else unprintable.
const CONTROL_BUT_NEWLINES = /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/

function numberIn(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null
}

const given = (value: unknown) => value !== undefined && value !== null && value !== ''

/** A link to open in the browser: http or https only, so no `javascript:` ever reaches an href. */
export function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_TEXT_LENGTH || CONTROL.test(value)) return null
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

/**
 * A model's info built field by field from an untrusted body: known fields
 * only, each checked. A field left out or empty is not kept.
 */
export function validateModelInfo(
  input: Record<string, unknown>,
  name: string,
  now = Date.now()
): { info: ModelInfo; errors?: undefined } | { info?: undefined; errors: ModelInfoErrors } {
  const errors: ModelInfoErrors = {}
  const info: ModelInfo = { name, updatedAt: now }

  if (given(input.url)) {
    const url = safeUrl(input.url)
    if (url) info.url = url
    else errors.url = 'modelInfo.errorUrl'
  }
  for (const field of ['notes', 'negativePrompt'] as const) {
    if (!given(input[field])) continue
    const value = input[field]
    if (typeof value !== 'string' || value.length > MAX_TEXT_LENGTH || CONTROL_BUT_NEWLINES.test(value)) errors[field] = 'settings.errorText'
    else info[field] = value
  }
  for (const field of ['sampler', 'scheduler'] as const) {
    if (!given(input[field])) continue
    const value = input[field]
    if (typeof value !== 'string' || !value.trim() || value.length > MAX_OPTION_LENGTH || CONTROL.test(value)) errors[field] = 'settings.errorText'
    else info[field] = value.trim()
  }
  if (given(input.steps)) {
    const value = numberIn(input.steps, 1, 200)
    if (value === null || !Number.isInteger(value)) errors.steps = 'settings.errorSteps'
    else info.steps = value
  }
  if (given(input.cfg)) {
    const value = numberIn(input.cfg, 0, 30)
    if (value === null) errors.cfg = 'settings.errorCfg'
    else info.cfg = value
  }
  for (const field of ['width', 'height'] as const) {
    if (!given(input[field])) continue
    const value = numberIn(input[field], 256, 4096)
    if (value === null || value % 8 !== 0) errors[field] = 'settings.errorSize'
    else info[field] = value
  }
  if (given(input.hires)) {
    const raw = input.hires as Record<string, unknown>
    const scale = numberIn(raw?.scale, HIRES_LIMITS.minScale, HIRES_LIMITS.maxScale)
    const steps = numberIn(raw?.steps, 0, HIRES_LIMITS.maxSteps)
    const denoise = numberIn(raw?.denoise, HIRES_LIMITS.minDenoise, HIRES_LIMITS.maxDenoise)
    const upscaler = typeof raw?.upscaler === 'string' && raw.upscaler.trim() && raw.upscaler.length <= MAX_OPTION_LENGTH && !CONTROL.test(raw.upscaler) ? raw.upscaler.trim() : null
    if (typeof raw !== 'object' || scale === null || steps === null || !Number.isInteger(steps) || denoise === null || upscaler === null) errors.hires = 'modelInfo.errorHires'
    else info.hires = { scale, steps, denoise, upscaler }
  }
  return Object.keys(errors).length ? { errors } : { info }
}

/**
 * The entries of a stored file that still check out: one edited by hand, or
 * written by a newer release, keeps what this one can read.
 */
export function parseStoredModelInfo(raw: unknown): Record<string, ModelInfo> {
  const models = (raw as { models?: unknown } | null)?.models
  const out = new Map<string, ModelInfo>()
  if (!models || typeof models !== 'object' || Array.isArray(models)) return {}
  for (const [key, entry] of Object.entries(models)) {
    if (out.size >= MAX_MODEL_INFO_ENTRIES) break
    if (!entry || typeof entry !== 'object') continue
    const name = modelName((entry as { name?: unknown }).name)
    if (!name || modelKey(name) !== key) continue
    const updatedAt = (entry as { updatedAt?: unknown }).updatedAt
    const checked = validateModelInfo(entry as Record<string, unknown>, name, typeof updatedAt === 'number' && Number.isFinite(updatedAt) ? updatedAt : 0)
    if (checked.info) out.set(key, checked.info)
  }
  return Object.fromEntries(out)
}

export function modelInfoPath(env: Env = process.env): string {
  return path.join(path.dirname(settingsPath(env)), 'latentry.models.json')
}

const globalForModelInfo = globalThis as typeof globalThis & {
  __latentryModelInfo?: { file: string; mtime: number; models: Record<string, ModelInfo>; version: number | null }
}

function readFile(env: Env): { models: Record<string, ModelInfo>; version: number | null } {
  const file = modelInfoPath(env)
  let fd: number
  try {
    fd = openSync(/*turbopackIgnore: true*/ file, 'r')
  } catch {
    return { models: {}, version: null }
  }
  restrictExistingToOwner(file)
  try {
    const mtime = fstatSync(fd).mtimeMs
    const cached = globalForModelInfo.__latentryModelInfo
    if (cached && cached.file === file && cached.mtime === mtime) return cached
    let models: Record<string, ModelInfo> = {}
    let version: number | null = null
    try {
      const raw = JSON.parse(readFileSync(fd, 'utf8'))
      models = parseStoredModelInfo(raw)
      version = typeof raw?.version === 'number' && Number.isFinite(raw.version) ? raw.version : null
    } catch (error) {
      console.error(`[models] could not read ${path.basename(file)}:`, error instanceof Error ? error.message : error)
    }
    globalForModelInfo.__latentryModelInfo = { file, mtime, models, version }
    return { models, version }
  } finally {
    closeSync(fd)
  }
}

/** Every model's info, by key. Re-read only when the file changes. */
export function readModelInfo(env: Env = process.env): Record<string, ModelInfo> {
  return readFile(env).models
}

/** Thrown when the file was written by a newer Latentry: writing it back could drop what this release does not know. */
export class NewerModelInfoError extends Error {
  constructor(readonly version: number) {
    super(`latentry.models.json is version ${version}; this Latentry writes version ${MODEL_INFO_VERSION}`)
    this.name = 'NewerModelInfoError'
  }
}

/** Thrown when a new model would take the file past MAX_MODEL_INFO_ENTRIES. */
export class TooManyModelsError extends Error {
  constructor() {
    super(`At most ${MAX_MODEL_INFO_ENTRIES} models`)
    this.name = 'TooManyModelsError'
  }
}

/** Keeps `info` for its model, or forgets the model at `key` when `info` is null. Atomic and owner-only. */
export async function saveModelInfo(key: string, info: ModelInfo | null, env: Env = process.env): Promise<void> {
  const file = modelInfoPath(env)
  const { models, version } = readFile(env)
  if (version !== null && version > MODEL_INFO_VERSION) throw new NewerModelInfoError(version)
  const next = new Map(Object.entries(models))
  if (info) {
    if (!next.has(key) && next.size >= MAX_MODEL_INFO_ENTRIES) throw new TooManyModelsError()
    next.set(key, info)
  } else if (!next.delete(key)) {
    return
  }
  await mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${randomBytes(4).toString('hex')}.tmp`
  try {
    await writeFile(temp, JSON.stringify({ version: MODEL_INFO_VERSION, models: Object.fromEntries(next) }, null, 2) + '\n', { mode: 0o600 })
    restrictToOwner(temp)
    await rename(temp, file)
  } catch (error) {
    await unlink(temp).catch(() => {})
    throw error
  }
  delete globalForModelInfo.__latentryModelInfo
}
