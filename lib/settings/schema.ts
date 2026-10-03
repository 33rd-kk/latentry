// What the settings file holds, and checking what the settings page sends.
//
// Every part is optional. A part that is absent falls back to the environment
// (.env.local), so a fresh install configured only by .env keeps working, and
// the settings page can take over one part at a time.
//
// Pure: no file system here (that is ./store.ts), so the verify script can
// exercise every rule.

import { BACKEND_KINDS, type BackendKind } from '@/lib/backends/types'
import { isProfileId, PROFILE_IDS, type ProfileChanges, type ProfileId } from '@/lib/profiles'

export const SETTINGS_VERSION = 1

export interface StoredBackend {
  id: string
  kind: BackendKind
  url: string
  profile: ProfileId
  /** Kept in the file; never sent to the browser. */
  token?: string
}

/** The fields of a profile the settings page can change (see lib/profiles). */
export type ProfileOverride = ProfileChanges

export const PROFILE_OVERRIDE_FIELDS = ['width', 'height', 'steps', 'cfg', 'negativePrompt', 'qualityTags', 'artistTemplate'] as const

export interface GallerySettings {
  /** Where finished images are saved; null turns saving off. */
  saveDir?: string | null
  /** Folders to browse, read-only. */
  dirs?: string[]
  autoTag?: boolean
}

export interface Settings {
  version: typeof SETTINGS_VERSION
  backends?: StoredBackend[]
  /** The backend that tags pictures; null means "the first that can". */
  tagger?: string | null
  gallery?: GallerySettings
  profiles?: Partial<Record<ProfileId, ProfileOverride>>
}

export const EMPTY_SETTINGS: Settings = { version: SETTINGS_VERSION }

export const BACKEND_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/

/** Field path -> message key, for showing next to the field that is wrong. */
export type SettingsErrors = Record<string, string>

function isKind(value: unknown): value is BackendKind {
  return typeof value === 'string' && (BACKEND_KINDS as readonly string[]).includes(value)
}

/** An http(s) URL, normalised; null for anything else. */
export function normalizeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

const isAbsolute = (value: string) => /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(value)

function numberIn(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null
}

/**
 * What the settings page sends for one backend. `token` is write-only:
 * a string sets it, "" clears it, and absent (or null) keeps whatever the file
 * already has for that id.
 */
export interface BackendInput {
  id: unknown
  kind: unknown
  url: unknown
  profile: unknown
  token?: unknown
}

export interface SettingsInput {
  backends?: BackendInput[] | null
  tagger?: unknown
  gallery?: { saveDir?: unknown; dirs?: unknown; autoTag?: unknown } | null
  profiles?: Record<string, Record<string, unknown>> | null
}

/**
 * Checks an edit from the settings page against the current settings and
 * returns what to store, or the errors by field. `null` for a part means "go
 * back to the environment" and removes it from the file. Directory existence
 * is checked separately (./store.ts), since that needs the file system.
 */
export function validateSettings(
  input: SettingsInput,
  current: Settings
): { ok: true; settings: Settings } | { ok: false; errors: SettingsErrors } {
  const errors: SettingsErrors = {}
  const next: Settings = { version: SETTINGS_VERSION }

  // Backends
  if (input.backends === undefined) {
    if (current.backends) next.backends = current.backends
  } else if (input.backends !== null) {
    if (!Array.isArray(input.backends)) {
      errors.backends = 'settings.errorList'
    } else {
      const seen = new Set<string>()
      const stored: StoredBackend[] = []
      input.backends.forEach((raw, index) => {
        const at = `backends.${index}`
        const id = typeof raw?.id === 'string' ? raw.id.trim().toLowerCase() : ''
        const url = normalizeUrl(raw?.url)
        if (!BACKEND_ID_PATTERN.test(id)) errors[`${at}.id`] = 'settings.errorBackendId'
        else if (seen.has(id)) errors[`${at}.id`] = 'settings.errorBackendDuplicate'
        if (!isKind(raw?.kind)) errors[`${at}.kind`] = 'settings.errorKind'
        if (!url) errors[`${at}.url`] = 'settings.errorUrl'
        if (!isProfileId(raw?.profile)) errors[`${at}.profile`] = 'settings.errorProfile'
        if (raw?.token !== undefined && raw.token !== null && typeof raw.token !== 'string') {
          errors[`${at}.token`] = 'settings.errorToken'
        }
        seen.add(id)
        if (Object.keys(errors).some((key) => key.startsWith(`${at}.`))) return
        const kept = current.backends?.find((backend) => backend.id === id)?.token
        const token = typeof raw.token === 'string' ? raw.token.trim() : kept
        stored.push({ id, kind: raw.kind as BackendKind, url: url!, profile: raw.profile as ProfileId, ...(token ? { token } : {}) })
      })
      next.backends = stored
    }
  }

  // Tagger
  if (input.tagger === undefined) {
    if (current.tagger !== undefined) next.tagger = current.tagger
  } else if (input.tagger === null || input.tagger === '') {
    next.tagger = null
  } else if (typeof input.tagger === 'string' && BACKEND_ID_PATTERN.test(input.tagger)) {
    next.tagger = input.tagger
  } else {
    errors.tagger = 'settings.errorBackendId'
  }

  // Gallery
  if (input.gallery === undefined) {
    if (current.gallery) next.gallery = current.gallery
  } else if (input.gallery !== null) {
    const gallery: GallerySettings = {}
    const { saveDir, dirs, autoTag } = input.gallery
    if (saveDir === null || saveDir === '') gallery.saveDir = null
    else if (typeof saveDir === 'string' && isAbsolute(saveDir.trim())) gallery.saveDir = saveDir.trim()
    else if (saveDir !== undefined) errors['gallery.saveDir'] = 'settings.errorAbsolute'
    if (dirs !== undefined) {
      if (!Array.isArray(dirs)) errors['gallery.dirs'] = 'settings.errorList'
      else {
        const cleaned = dirs.map((dir) => (typeof dir === 'string' ? dir.trim() : '')).filter(Boolean)
        cleaned.forEach((dir, index) => {
          if (!isAbsolute(dir)) errors[`gallery.dirs.${index}`] = 'settings.errorAbsolute'
        })
        gallery.dirs = cleaned
      }
    }
    if (autoTag !== undefined) gallery.autoTag = autoTag === true
    next.gallery = gallery
  }

  // Profiles
  if (input.profiles === undefined) {
    if (current.profiles) next.profiles = current.profiles
  } else if (input.profiles !== null) {
    const profiles: Partial<Record<ProfileId, ProfileOverride>> = {}
    for (const [id, raw] of Object.entries(input.profiles)) {
      if (!isProfileId(id) || !raw || typeof raw !== 'object') continue
      const override: ProfileOverride = {}
      const at = `profiles.${id}`
      for (const field of ['width', 'height'] as const) {
        if (raw[field] === undefined || raw[field] === null) continue
        const value = numberIn(raw[field], 256, 4096)
        if (value === null || value % 8 !== 0) errors[`${at}.${field}`] = 'settings.errorSize'
        else override[field] = value
      }
      if (raw.steps !== undefined && raw.steps !== null) {
        const value = numberIn(raw.steps, 1, 200)
        if (value === null || !Number.isInteger(value)) errors[`${at}.steps`] = 'settings.errorSteps'
        else override.steps = value
      }
      if (raw.cfg !== undefined && raw.cfg !== null) {
        const value = numberIn(raw.cfg, 0, 30)
        if (value === null) errors[`${at}.cfg`] = 'settings.errorCfg'
        else override.cfg = value
      }
      for (const field of ['negativePrompt', 'qualityTags'] as const) {
        if (raw[field] === undefined || raw[field] === null) continue
        if (typeof raw[field] !== 'string' || (raw[field] as string).length > 2000) errors[`${at}.${field}`] = 'settings.errorText'
        else override[field] = raw[field] as string
      }
      if (raw.artistTemplate !== undefined) {
        if (raw.artistTemplate === null || raw.artistTemplate === '') override.artistTemplate = null
        else if (typeof raw.artistTemplate === 'string' && raw.artistTemplate.includes('{artist}') && raw.artistTemplate.length <= 100) {
          override.artistTemplate = raw.artistTemplate
        } else errors[`${at}.artistTemplate`] = 'settings.errorArtistTemplate'
      }
      if (Object.keys(override).length) profiles[id] = override
    }
    next.profiles = profiles
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, settings: next }
}

/** The settings as stored, minus anything a browser must not see. */
export function redactSettings(settings: Settings): Omit<Settings, 'backends'> & {
  backends?: (Omit<StoredBackend, 'token'> & { hasToken: boolean })[]
} {
  const { backends, ...rest } = settings
  return {
    ...rest,
    ...(backends ? { backends: backends.map(({ token, ...backend }) => ({ ...backend, hasToken: Boolean(token) })) } : {}),
  }
}

/** A settings file as read from disk, with anything malformed dropped rather than trusted. */
export function parseStoredSettings(raw: unknown): Settings {
  if (!raw || typeof raw !== 'object') return EMPTY_SETTINGS
  const checked = validateSettings(raw as SettingsInput, EMPTY_SETTINGS)
  if (checked.ok) return checked.settings
  // A hand-edited file with one bad field: keep the parts that are fine.
  const parts: SettingsInput = {}
  const record = raw as Record<string, unknown>
  for (const part of ['backends', 'tagger', 'gallery', 'profiles'] as const) {
    if (record[part] === undefined) continue
    const one = validateSettings({ [part]: record[part] } as SettingsInput, EMPTY_SETTINGS)
    if (one.ok) Object.assign(parts, { [part]: record[part] })
    else console.warn(`[settings] ignoring "${part}" in the settings file:`, one.errors)
  }
  const salvaged = validateSettings(parts, EMPTY_SETTINGS)
  return salvaged.ok ? salvaged.settings : EMPTY_SETTINGS
}

export { PROFILE_IDS }
