// The gallery's search box.
//
//   long hair, smile        two terms; each must appear (spaces inside a term are kept)
//   "long hair"             a tag, matched exactly: not "very long hair"
//   "long hair", outdoors   both kinds together
//   model:noobai            a setting: model or sampler name contains the text
//   steps:>=30, w:1024      a number: = (the default), >, >=, <, <=
//
// Settings you can name: model, sampler, seed, steps, cfg, w (width), h
// (height). A term with any other key, or a number key without a number, is
// searched as plain text, so "score:9" still finds a prompt that says it.
//
// Terms are separated by commas, the way prompts separate tags, so a tag of
// several words stays one term. Underscores and spaces are the same thing
// (`long_hair` = `long hair`), and case does not matter.
//
// Pure, so the verify script can pin it down.

import type { ImageMeta } from '../image-meta'

export const TEXT_FIELDS = ['model', 'sampler'] as const
export const NUMBER_FIELDS = ['seed', 'steps', 'cfg', 'w', 'h'] as const
type TextField = (typeof TEXT_FIELDS)[number]
type NumberField = (typeof NUMBER_FIELDS)[number]
type Comparison = '=' | '>' | '>=' | '<' | '<='

export type FieldTerm =
  | { key: TextField; contains: string }
  | { key: NumberField; op: Comparison; value: number }

export interface SearchTerm {
  text: string
  /** Quoted: must equal one of the picture's tags. */
  exact: boolean
  /** `key:value`: matched against that setting instead of the text. */
  field?: FieldTerm
}

/** Lowercase, underscores to spaces, runs of whitespace to one space. */
export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * A prompt token as a bare tag: weights and emphasis removed, so
 * `(long hair:1.2)` and `[long hair]` both count as `long hair`, and the
 * Danbooru escapes `\(` `\)` as plain parentheses.
 */
export function normalizeTag(token: string): string {
  // Escaped brackets belong to the tag ("name \(series\)"); park them as
  // placeholders the stripping below cannot see, and put them back after.
  const BRACKETS = '()[]'
  let tag = token.trim().replace(/\\([()[\]])/g, (_, bracket: string) => `\u0001${BRACKETS.indexOf(bracket)}`)
  // Strip enclosing ( ) [ ] { } and a trailing :weight, possibly nested.
  for (let i = 0; i < 4; i += 1) {
    const before = tag
    tag = tag.replace(/^[([{]+/, '').replace(/[)\]}]+$/, '').replace(/:\s*-?\d+(\.\d+)?$/, '').trim()
    if (tag === before) break
  }
  return normalizeText(tag.replace(/\u0001(\d)/g, (_, index: string) => BRACKETS[Number(index)]))
}

/** A `key:value` term as a setting to match, or null to search it as text. */
function fieldOf(raw: string): FieldTerm | null {
  const match = /^\s*([a-z]+)\s*:\s*(.*?)\s*$/i.exec(raw)
  if (!match) return null
  const key = match[1].toLowerCase()
  const value = match[2]
  if ((TEXT_FIELDS as readonly string[]).includes(key)) {
    const contains = normalizeText(value)
    return contains ? { key: key as TextField, contains } : null
  }
  if ((NUMBER_FIELDS as readonly string[]).includes(key)) {
    const number = /^(>=|<=|>|<|=)?\s*(-?\d+(?:\.\d+)?)$/.exec(value)
    return number ? { key: key as NumberField, op: (number[1] as Comparison | undefined) ?? '=', value: Number(number[2]) } : null
  }
  return null
}

/** Splits the search box into terms: commas separate, quotes mark an exact tag. */
export function parseQuery(query: string): SearchTerm[] {
  const terms: SearchTerm[] = []
  let current = ''
  let quoted = false
  let wasQuoted = false
  const flush = () => {
    const text = wasQuoted ? normalizeTag(current) : normalizeText(current)
    const field = wasQuoted ? null : fieldOf(current)
    if (field) terms.push({ text, exact: false, field })
    else if (text) terms.push({ text, exact: wasQuoted })
    current = ''
    wasQuoted = false
  }
  for (const char of query) {
    if (char === '"') {
      quoted = !quoted
      if (quoted) {
        // Text before an opening quote in the same term is dropped with it:
        // a quoted term is the whole term.
        current = ''
        wasQuoted = true
      }
      continue
    }
    if (char === ',' && !quoted) {
      flush()
      continue
    }
    current += char
  }
  flush()
  return terms
}

/** Everything about a picture a term can match, prepared once per picture. */
export interface Searchable {
  /** File name, prompt, model and tag names, normalised and joined. */
  text: string
  /** Every tag: the prompt's tokens and the WD14 tags. */
  tags: Set<string>
  /** The settings a `key:value` term can name; text ones normalised. */
  fields: Partial<Record<TextField, string> & Record<NumberField, number>>
}

/**
 * `size` is the picture's real size when known; the size in its settings
 * stands in otherwise (an upscaled picture's differ).
 */
export function searchableOf(name: string, meta: ImageMeta | null, size?: { width: number | null; height: number | null }): Searchable {
  const promptTags = (meta?.prompt ?? '').split(',').map(normalizeTag).filter(Boolean)
  const wdTags = (meta?.tags ?? []).map((tag) => normalizeTag(tag.name)).filter(Boolean)
  return {
    text: [normalizeText(name), normalizeText(meta?.prompt ?? ''), normalizeText(meta?.model ?? ''), ...wdTags].join('\n'),
    tags: new Set([...promptTags, ...wdTags]),
    fields: {
      model: meta?.model ? normalizeText(meta.model) : undefined,
      sampler: meta?.sampler ? normalizeText(meta.sampler) : undefined,
      seed: meta?.seed,
      steps: meta?.steps,
      cfg: meta?.cfg,
      w: size?.width ?? meta?.width,
      h: size?.height ?? meta?.height,
    },
  }
}

function matchesField(searchable: Searchable, field: FieldTerm): boolean {
  if ('contains' in field) return searchable.fields[field.key]?.includes(field.contains) ?? false
  const actual = searchable.fields[field.key]
  if (actual === undefined) return false
  switch (field.op) {
    case '>':
      return actual > field.value
    case '>=':
      return actual >= field.value
    case '<':
      return actual < field.value
    case '<=':
      return actual <= field.value
    default:
      return actual === field.value
  }
}

export function matchesQuery(searchable: Searchable, terms: SearchTerm[]): boolean {
  return terms.every((term) =>
    term.field ? matchesField(searchable, term.field) : term.exact ? searchable.tags.has(term.text) : searchable.text.includes(term.text)
  )
}

/** The search-box text that finds exactly this tag. */
export function exactTagQuery(tag: string): string {
  return `"${tag.replace(/"/g, '')}"`
}
