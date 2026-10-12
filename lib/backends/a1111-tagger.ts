// The WD14 tagger extension (/tagger/v1/*) as the A1111 adapter (./a1111.ts)
// uses it: which model to ask, and its answer as tags.

import type { WdTag } from './types'

// Ratings the tagger extension mixes into its answer; never a prompt tag.
const RATING_TAGS = new Set(['general', 'sensitive', 'questionable', 'explicit'])

/** Picks the tagger model: A1111_TAGGER_MODEL if set, else the first WD one. */
export function chooseTaggerModel(models: string[], preferred?: string): string | null {
  if (!models.length) return null
  if (preferred && models.includes(preferred)) return preferred
  return models.find((model) => /wd/i.test(model)) ?? models[0]
}

/**
 * The tagger extension's answer as WD14 tags. Older builds return one flat
 * { tag: score } map with the ratings mixed in; newer ones split it into
 * { rating, general, character } maps.
 */
export function parseTaggerCaption(caption: unknown): WdTag[] {
  if (!caption || typeof caption !== 'object') return []
  const entries = Object.entries(caption as Record<string, unknown>)
  const tags: WdTag[] = []
  const push = (name: string, score: unknown, category: number) => {
    if (typeof score === 'number' && Number.isFinite(score)) tags.push({ name, score, category })
  }
  const grouped = entries.some(([, value]) => value && typeof value === 'object')
  if (grouped) {
    for (const [group, map] of entries) {
      if (group === 'rating' || !map || typeof map !== 'object') continue
      const category = group === 'character' ? 4 : 0
      for (const [name, score] of Object.entries(map as Record<string, unknown>)) push(name, score, category)
    }
  } else {
    for (const [name, score] of entries) if (!RATING_TAGS.has(name)) push(name, score, 0)
  }
  return tags.sort((a, b) => b.score - a.score)
}
