// The gallery's search box.
//
//   long hair, smile        two terms; each must appear (spaces inside a term are kept)
//   "long hair"             a tag, matched exactly: not "very long hair"
//   "long hair", outdoors   both kinds together
//
// Terms are separated by commas, the way prompts separate tags, so a tag of
// several words stays one term. Underscores and spaces are the same thing
// (`long_hair` = `long hair`), and case does not matter.
//
// Pure, so the verify script can pin it down.

import type { ImageMeta } from './png-meta'

export interface SearchTerm {
  text: string
  /** Quoted: must equal one of the picture's tags. */
  exact: boolean
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

/** Splits the search box into terms: commas separate, quotes mark an exact tag. */
export function parseQuery(query: string): SearchTerm[] {
  const terms: SearchTerm[] = []
  let current = ''
  let quoted = false
  let wasQuoted = false
  const flush = () => {
    const text = wasQuoted ? normalizeTag(current) : normalizeText(current)
    if (text) terms.push({ text, exact: wasQuoted })
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
}

export function searchableOf(name: string, meta: ImageMeta | null): Searchable {
  const promptTags = (meta?.prompt ?? '').split(',').map(normalizeTag).filter(Boolean)
  const wdTags = (meta?.tags ?? []).map((tag) => normalizeTag(tag.name)).filter(Boolean)
  return {
    text: [normalizeText(name), normalizeText(meta?.prompt ?? ''), normalizeText(meta?.model ?? ''), ...wdTags].join('\n'),
    tags: new Set([...promptTags, ...wdTags]),
  }
}

export function matchesQuery(searchable: Searchable, terms: SearchTerm[]): boolean {
  return terms.every((term) => (term.exact ? searchable.tags.has(term.text) : searchable.text.includes(term.text)))
}

/** The search-box text that finds exactly this tag. */
export function exactTagQuery(tag: string): string {
  return `"${tag.replace(/"/g, '')}"`
}
