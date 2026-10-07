// Reads the backends this install talks to from the environment.
//
//   GEN_BACKENDS=id|kind|url|profile;id|kind|url|profile
//   GEN_TOKEN_<ID>=secret
//
// for example
//
//   GEN_BACKENDS=anima|diffusers|http://localhost:7865|anima;sdxl|a1111|http://localhost:7860|illustrious
//
// The ids are what the browser sees (in /api/gen/<id>/...), so they are the
// only part of an entry that ever leaves the server. A single
// DIFFUSION_SERVER_URL (+ DIFFUSION_API_TOKEN) is still read when
// GEN_BACKENDS is unset, as one diffusers backend with the generic profile.
//
// Backends saved from the settings page (latentry.settings.json) replace all
// of this. A saved backend without a token still picks up GEN_TOKEN_<ID>, but
// only while GEN_BACKENDS lists that id at the same address (scheme, host and
// port): a token is never sent to a server it was not set up for, whoever
// edits the settings.

import { BACKEND_KINDS, type BackendConfig, type BackendKind } from './types'
import { isProfileId } from '@/lib/profiles'
import { sameOrigin, type Settings } from '@/lib/settings/schema'
import { getSettings } from '@/lib/settings/store'
import { engineBackends } from '@/lib/engine/supervisor'

type Env = Record<string, string | undefined>

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/

export interface BackendConfigResult {
  backends: BackendConfig[]
  /** Entries that were skipped, and why — logged once, so a typo is not silent. */
  problems: string[]
}

function tokenFor(id: string, env: Env): string | undefined {
  const key = `GEN_TOKEN_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
  const value = env[key]?.trim()
  return value ? value : undefined
}

function isKind(value: string): value is BackendKind {
  return (BACKEND_KINDS as readonly string[]).includes(value)
}

/** Pure, so the verify script can feed it any environment. */
export function parseBackends(env: Env): BackendConfigResult {
  const problems: string[] = []
  const raw = env.GEN_BACKENDS?.trim()

  if (!raw) {
    const legacy = env.DIFFUSION_SERVER_URL?.trim()
    if (!legacy) return { backends: [], problems }
    const token = env.DIFFUSION_API_TOKEN?.trim()
    return {
      backends: [{ id: 'default', kind: 'diffusers', url: legacy, profile: 'generic', ...(token ? { token } : {}) }],
      problems,
    }
  }

  const backends: BackendConfig[] = []
  const seen = new Set<string>()
  for (const entry of raw.split(';').map((part) => part.trim()).filter(Boolean)) {
    const [id = '', kind = '', url = '', profile = 'generic'] = entry.split('|').map((part) => part.trim())
    const normalizedId = id.toLowerCase()

    if (!ID_PATTERN.test(normalizedId)) {
      problems.push(`"${id}": an id is 1-32 of a-z, 0-9, "-" and "_"`)
      continue
    }
    if (seen.has(normalizedId)) {
      problems.push(`"${id}": listed twice`)
      continue
    }
    if (!isKind(kind)) {
      problems.push(`"${id}": unknown kind "${kind}" (expected ${BACKEND_KINDS.join(' or ')})`)
      continue
    }
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      problems.push(`"${id}": "${url}" is not a URL`)
      continue
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      problems.push(`"${id}": only http and https URLs are supported`)
      continue
    }
    if (!isProfileId(profile)) {
      problems.push(`"${id}": unknown profile "${profile}"`)
      continue
    }

    seen.add(normalizedId)
    const token = tokenFor(normalizedId, env)
    backends.push({ id: normalizedId, kind, url: parsed.toString(), profile, ...(token ? { token } : {}) })
  }

  return { backends, problems }
}

let cached: { raw: string; result: BackendConfigResult } | null = null

function fromEnv(env: Env): BackendConfig[] {
  const raw = [env.GEN_BACKENDS, env.DIFFUSION_SERVER_URL, env.DIFFUSION_API_TOKEN].join('\u0000')
  if (cached?.raw !== raw) {
    const result = parseBackends(env)
    for (const problem of result.problems) console.warn(`[GEN_BACKENDS] skipped ${problem}`)
    cached = { raw, result }
  }
  return cached.result.backends
}

/** The environment's token for this id, if the environment set it up for this address. */
function envTokenFor(id: string, url: string, env: Env): string | undefined {
  const configured = fromEnv(env).find((backend) => backend.id === id)
  return configured?.token && sameOrigin(configured.url, url) ? configured.token : undefined
}

/** Where the backends come from right now, for the settings page. */
export function backendsSource(settings: Settings = getSettings()): 'settings' | 'env' {
  return settings.backends ? 'settings' : 'env'
}

/** The configured backends: the settings file's, else the environment's. */
export function getBackends(env: Env = process.env, settings: Settings = getSettings()): BackendConfig[] {
  if (!settings.backends) return fromEnv(env)
  return settings.backends.map(({ token, ...backend }) => {
    const resolved = token ?? envTokenFor(backend.id, backend.url, env)
    return { ...backend, ...(resolved ? { token: resolved } : {}) }
  })
}

/**
 * Every backend the app can use: the configured ones, then Latentry's own
 * running engines. A configured backend keeps its id if an engine would
 * take the same one.
 */
export function usableBackends(env: Env = process.env): BackendConfig[] {
  const configured = getBackends(env)
  const ids = new Set(configured.map((backend) => backend.id))
  return [...configured, ...engineBackends().filter((engine) => !ids.has(engine.id))]
}

export function getBackendConfig(id: string, env: Env = process.env): BackendConfig | null {
  return usableBackends(env).find((backend) => backend.id === id) ?? null
}

/** The backend /api/gen/tag sends pictures to: the setting, else TAGGER_BACKEND, else the first that can tag. */
export function taggerPreference(env: Env = process.env, settings: Settings = getSettings()): string | null {
  if (settings.tagger !== undefined) return settings.tagger
  const preferred = env.TAGGER_BACKEND?.trim().toLowerCase()
  return preferred ? preferred : null
}

/** Whether GEN_TOKEN_<ID> applies to this backend, for the settings page (never the value). */
export function hasEnvToken(id: string, url: string, env: Env = process.env): boolean {
  return Boolean(envTokenFor(id, url, env))
}
