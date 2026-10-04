// Who tags a picture: Latentry's own WD14 model, or a backend's tagger.
//
//   TAGGER_BACKEND=builtin | <backend id>      (or the settings page)
//   WD14_MODEL_DIR=/path/to/wd-eva02-large-tagger-v3
//   WD14_THRESHOLD=0.35  WD14_CHARACTER_THRESHOLD=0.85
//
// Unset, the built-in model is used when its folder is configured, and the
// first backend that can tag otherwise.

import { adapterFor, getAdapter, usableBackends } from '@/lib/backends'
import { taggerPreference } from '@/lib/backends/config'
import type { Outcome, WdTag } from '@/lib/backends/types'
import { BUILTIN_TAGGER, type Settings } from '@/lib/settings/schema'
import { getSettings } from '@/lib/settings/store'
import { DEFAULT_THRESHOLDS, hasModel, tagImage, type Wd14Thresholds } from './wd14'

type Env = Record<string, string | undefined>

export interface Tagger {
  /** BUILTIN_TAGGER or the backend's id. */
  id: string
  tag(imageBase64: string): Promise<Outcome<{ tags: WdTag[] }>>
}

export interface Wd14Config {
  modelDir: string | null
  thresholds: Wd14Thresholds
  source: { modelDir: 'settings' | 'env' }
}

function threshold(value: unknown, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) && number > 0 && number <= 1 ? number : fallback
}

export function wd14Config(env: Env = process.env, settings: Settings = getSettings()): Wd14Config {
  const fromSettings = settings.wd14?.modelDir !== undefined
  const modelDir = fromSettings ? settings.wd14!.modelDir! : env.WD14_MODEL_DIR?.trim() || null
  return {
    modelDir: modelDir || null,
    thresholds: {
      general: threshold(settings.wd14?.general ?? env.WD14_THRESHOLD, DEFAULT_THRESHOLDS.general),
      character: threshold(settings.wd14?.character ?? env.WD14_CHARACTER_THRESHOLD, DEFAULT_THRESHOLDS.character),
    },
    source: { modelDir: fromSettings ? 'settings' : 'env' },
  }
}

export function builtinTagger(config: Wd14Config = wd14Config()): Tagger | null {
  const { modelDir, thresholds } = config
  if (!modelDir || !hasModel(modelDir)) return null
  return {
    id: BUILTIN_TAGGER,
    async tag(imageBase64) {
      try {
        return { ok: true, value: { tags: await tagImage(modelDir, imageBase64, thresholds) } }
      } catch (error) {
        console.error('Built-in WD14 failed:', error)
        return { ok: false, status: 500, error: error instanceof Error ? error.message : 'Tagging failed' }
      }
    },
  }
}

function fromAdapter(adapter: ReturnType<typeof adapterFor>): Tagger | null {
  return adapter.tag ? { id: adapter.config.id, tag: (image) => adapter.tag!(image) } : null
}

/** What /api/gen/tag, the gallery and auto-tagging send pictures to; null when nothing can tag. */
export async function getTagger(): Promise<Tagger | null> {
  const preferred = taggerPreference()
  if (preferred === BUILTIN_TAGGER) return builtinTagger()
  if (preferred) {
    const adapter = getAdapter(preferred)
    return adapter ? fromAdapter(adapter) : null
  }
  const builtin = builtinTagger()
  if (builtin) return builtin
  for (const config of usableBackends()) {
    const adapter = adapterFor(config)
    if (!adapter.tag) continue
    const status = await adapter.status()
    if (status.alive && status.capabilities.tag) return fromAdapter(adapter)
  }
  return null
}

/**
 * The tagger's id without asking every backend again, for the page: the
 * statuses in hand say which backends can tag right now.
 */
export function taggerIdFrom(statuses: { id: string; alive: boolean; capabilities: { tag: boolean } }[]): string | null {
  const preferred = taggerPreference()
  if (preferred === BUILTIN_TAGGER) return builtinTagger() ? BUILTIN_TAGGER : null
  if (preferred) return statuses.find((status) => status.id === preferred && status.capabilities.tag)?.id ?? null
  if (builtinTagger()) return BUILTIN_TAGGER
  return statuses.find((status) => status.alive && status.capabilities.tag)?.id ?? null
}
