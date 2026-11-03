// What the gallery's search box suggests while you type: the tags of the
// pictures already shown, the settings a term can name (`model:`, `steps:`…)
// and their values, and how to write a search (`"exact"`, `-leave out`).
//
// Only what the page already holds is used: nothing is asked of the server
// for it, and nothing is kept. In secret mode no tag or name is suggested,
// only how to write a search.
//
// Terms are found the way parseQuery (./query.ts) splits them: commas
// separate, except inside quotes. Pure, so the verify script can pin it down.

import { NUMBER_FIELDS, normalizeText, TEXT_FIELDS } from './query'

export const MAX_SUGGESTIONS = 10
const FIELDS = [...TEXT_FIELDS, ...NUMBER_FIELDS] as const
type Field = (typeof FIELDS)[number]

/** The term the caret is in, and how it has been written so far. */
export interface TermAt {
  /** Where it starts and ends in the text (the commas around it excluded). */
  start: number
  end: number
  /** Written with a leading `-`. */
  negate: boolean
  /** Opened with a quote: an exact tag. */
  quoted: boolean
  /** `key:` before the caret, when the key is one a term can name. */
  field: Field | null
  /** What is typed of the tag or value, up to the caret, as written. */
  typed: string
}

export function termAt(text: string, caret: number): TermAt {
  let start = 0
  let quoted = false
  for (let i = 0; i < caret && i < text.length; i += 1) {
    if (text[i] === '"') quoted = !quoted
    else if (text[i] === ',' && !quoted) start = i + 1
  }
  let end = text.length
  for (let i = caret, inQuote = quoted; i < text.length; i += 1) {
    if (text[i] === '"') inQuote = !inQuote
    else if (text[i] === ',' && !inQuote) {
      end = i
      break
    }
  }
  let before = text.slice(start, caret).trimStart()
  const negate = before.startsWith('-')
  if (negate) before = before.slice(1).trimStart()
  const opened = before.startsWith('"')
  if (opened) before = before.slice(1)
  const key = opened ? null : /^([a-z]+)\s*:\s*(.*)$/i.exec(before)
  const field = key && (FIELDS as readonly string[]).includes(key[1].toLowerCase()) ? (key[1].toLowerCase() as Field) : null
  return { start, end, negate, quoted: opened, field, typed: field && key ? key[2] : before.replace(/"$/, '') }
}

export interface SuggestSource {
  /** Tags of the pictures shown, normalised, with how many of them carry each. */
  tags: ReadonlyMap<string, number>
  models: readonly string[]
  loras: readonly string[]
  samplers: readonly string[]
}

export type SuggestionKind = 'tag' | 'value' | 'field' | 'syntax'

export interface Suggestion {
  kind: SuggestionKind
  /** What goes in place of the term. */
  insert: string
  /** What the list shows. */
  label: string
  /** For a tag: how many pictures shown carry it. */
  count?: number
  /** For a field or the syntax: which one, for its description. */
  name?: Field | 'exact' | 'exclude' | 'atLeast' | 'atMost'
  /** The term is not finished: no comma after it, the caret stays at its end. */
  open?: boolean
}

/** Names in order: those starting with what is typed, then those containing it; more pictures first. */
function ranked(names: Iterable<[string, number]>, typed: string): [string, number][] {
  const query = normalizeText(typed)
  const starts: [string, number][] = []
  const contains: [string, number][] = []
  for (const entry of names) {
    const name = normalizeText(entry[0])
    if (!query || name.startsWith(query)) starts.push(entry)
    else if (name.includes(query)) contains.push(entry)
  }
  const order = (a: [string, number], b: [string, number]) => b[1] - a[1] || a[0].localeCompare(b[0])
  return [...starts.sort(order), ...contains.sort(order)]
}

export function suggest(term: TermAt, source: SuggestSource, options: { secret: boolean }): Suggestion[] {
  const minus = term.negate ? '-' : ''
  const out: Suggestion[] = []

  if (term.field) {
    const key = term.field
    if ((NUMBER_FIELDS as readonly string[]).includes(key)) {
      // A number: the comparisons, while none is typed yet.
      if (!term.typed.trim()) {
        out.push({ kind: 'syntax', name: 'atLeast', insert: `${minus}${key}:>=`, label: `${key}:>=`, open: true })
        out.push({ kind: 'syntax', name: 'atMost', insert: `${minus}${key}:<=`, label: `${key}:<=`, open: true })
      }
      return out
    }
    // Names are what secret mode does not show.
    if (options.secret) return out
    const names = key === 'model' ? source.models : key === 'lora' ? source.loras : source.samplers
    for (const [name] of ranked(names.map((name) => [name, 0] as [string, number]), term.typed)) {
      if (out.length >= MAX_SUGGESTIONS) break
      if (normalizeText(name) === normalizeText(term.typed)) continue
      out.push({ kind: 'value', insert: `${minus}${key}:${name}`, label: `${key}:${name}` })
    }
    return out
  }

  const typed = term.typed.trim()
  if (!typed && !term.quoted) {
    out.push({ kind: 'syntax', name: 'exact', insert: `${minus}"`, label: '"…"', open: true })
    if (!term.negate) out.push({ kind: 'syntax', name: 'exclude', insert: '-', label: '-…', open: true })
    for (const key of FIELDS) out.push({ kind: 'field', name: key, insert: `${minus}${key}:`, label: `${key}:`, open: true })
    return out.slice(0, MAX_SUGGESTIONS)
  }
  // A setting whose name starts with what is typed ("mo" → model:).
  if (!term.quoted && /^[a-z]+$/i.test(typed)) {
    for (const key of FIELDS) {
      if (key.startsWith(typed.toLowerCase()) && key !== typed.toLowerCase()) {
        out.push({ kind: 'field', name: key, insert: `${minus}${key}:`, label: `${key}:`, open: true })
      }
    }
  }
  if (options.secret) return out
  for (const [tag, count] of ranked(source.tags, typed)) {
    if (out.length >= MAX_SUGGESTIONS) break
    // Already written in full: nothing to add.
    if (tag === normalizeText(typed) && !term.quoted) continue
    out.push({ kind: 'tag', insert: term.quoted ? `${minus}"${tag}"` : `${minus}${tag}`, label: tag, count })
  }
  return out
}

/** The text with `suggestion` in place of `term`, and where the caret goes. */
export function applySuggestion(text: string, term: TermAt, suggestion: Suggestion): { text: string; caret: number } {
  const head = text.slice(0, term.start)
  // After a comma, one space, as prompts are written.
  const lead = term.start > 0 ? ' ' : ''
  const tail = text.slice(term.end)
  const inserted = head + lead + suggestion.insert
  if (suggestion.open) return { text: inserted + tail, caret: inserted.length }
  // A finished term: the comma after it, unless one is there already.
  if (/^\s*,/.test(tail)) {
    const rest = tail.replace(/^\s*,\s*/, '')
    return { text: `${inserted}, ${rest}`, caret: inserted.length + 2 }
  }
  return { text: `${inserted}, ${tail.trimStart()}`, caret: inserted.length + 2 }
}
