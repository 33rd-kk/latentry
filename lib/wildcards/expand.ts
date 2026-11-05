// Wildcards in a prompt: `__name__` is replaced by one line of the wildcard
// file `name.txt`, as in the Dynamic Prompts extension for A1111 (whose file
// layout this follows, so an existing wildcards folder works as it is):
// `__dir/name__` reads from a subfolder, and a picked line may hold
// wildcards of its own. A variant, `{a|b|c}` (see ./syntax.ts), is replaced
// by the choices it draws.
//
// Pure apart from the reader it is given, and free of Latentry imports, so it
// can be split out on its own. Server only (node:crypto); ./syntax.ts is the
// part the browser may use.

import { createHash, randomInt } from 'node:crypto'
import { findVariants, MAX_EXPANDED_CHARS, MAX_WILDCARD_DEPTH, TOKEN, wildcardPath, type Variant } from './syntax'

export type WildcardProblem = 'unknown' | 'empty' | 'tooDeep' | 'tooLong'

export class WildcardError extends Error {
  constructor(
    readonly problem: WildcardProblem,
    /** The wildcard that caused it, as written between the underscores; or a variant, braces and all. */
    readonly wildcard: string
  ) {
    super(`${problem}: __${wildcard}__`)
    this.name = 'WildcardError'
  }
}

/** A variant as an error names it: its start, when it is long. */
const shortVariant = (text: string) => (text.length > 40 ? `${text.slice(0, 39)}…` : text)

/** How an error names what caused it: `__name__`, or the variant as written. */
export const problemName = (error: WildcardError) => (error.wildcard.startsWith('{') ? error.wildcard : `__${error.wildcard}__`)

/** A wildcard file's lines by name, or null when there is no such file. */
export type WildcardReader = (path: string) => Promise<string[] | null>

export interface Pick {
  wildcard: string
  line: string
}

/**
 * A number below `count`. With a seed (0 or more) the same seed and key always
 * give the same one, so a run can be drawn again; with -1, a random one.
 */
function draw(count: number, seed: number, key: string): number {
  if (seed < 0) return randomInt(count)
  const digest = createHash('sha256').update(`${seed}\u0000${key}`).digest()
  return digest.readUIntBE(0, 6) % count
}

/** Which line to take, by the wildcard and how many times it came before. */
function choose(lines: string[], seed: number, wildcard: string, occurrence: number): string {
  return lines[draw(lines.length, seed, `${wildcard}\u0000${occurrence}`)]
}

/**
 * Which choices a variant takes, in the order drawn, never one twice. The key
 * starts with `{}`, which no wildcard name can be.
 */
function chooseVariant(variant: Variant, seed: number, occurrence: number): string[] {
  const key = `{}\u0000${occurrence}`
  const max = Math.min(variant.max ?? variant.choices.length, variant.choices.length)
  const min = Math.min(variant.min, max)
  const count = min + draw(max - min + 1, seed, `${key}\u0000count`)
  const left = [...variant.choices]
  const taken: string[] = []
  for (let n = 0; n < count; n++) taken.push(left.splice(draw(left.length, seed, `${key}\u0000${n}`), 1)[0])
  return taken
}

/**
 * Replaces every wildcard in each text, the texts in order. The occurrence
 * count runs across all of them, so a wildcard used twice can take two
 * different lines. Throws a WildcardError for a wildcard with no file (or no
 * lines), one nested too deep, or a result too long.
 */
export async function expandWildcards(texts: string[], seed: number, read: WildcardReader): Promise<{ texts: string[]; picks: Pick[] }> {
  const cache = new Map<string, string[] | null>()
  const counts = new Map<string, number>()
  const picks: Pick[] = []

  const lines = async (wildcard: string): Promise<string[]> => {
    const path = wildcardPath(wildcard)
    if (!path) throw new WildcardError('unknown', wildcard)
    if (!cache.has(path)) cache.set(path, await read(path))
    const found = cache.get(path)
    if (!found) throw new WildcardError('unknown', wildcard)
    if (!found.length) throw new WildcardError('empty', wildcard)
    return found
  }

  let variantsSeen = 0
  const expand = async (text: string, depth: number): Promise<string> => {
    // Variants, and the wildcards outside them, in the order they are written.
    // A variant's own wildcards are met when its choices are expanded. Its
    // choices are part of the text, so they add no depth: only a file's line
    // can lead back to itself.
    const variants = text.includes('{') ? findVariants(text) : []
    const outside = (at: number) => !variants.some((variant) => at >= variant.start && at < variant.end)
    const parts = [
      ...variants.map((variant) => ({ start: variant.start, end: variant.end, variant, wildcard: '' })),
      ...[...text.matchAll(TOKEN)]
        .filter((match) => outside(match.index))
        .map((match) => ({ start: match.index, end: match.index + match[0].length, variant: null, wildcard: match[1] })),
    ].sort((a, b) => a.start - b.start)

    let out = ''
    let last = 0
    for (const part of parts) {
      out += text.slice(last, part.start)
      if (part.variant) {
        const taken = chooseVariant(part.variant, seed, variantsSeen++)
        picks.push({ wildcard: text.slice(part.start, part.end), line: taken.join(part.variant.separator) })
        const filled: string[] = []
        for (const choice of taken) filled.push(await expand(choice, depth))
        out += filled.filter((choice) => choice !== '').join(part.variant.separator)
      } else {
        const wildcard = part.wildcard
        if (depth >= MAX_WILDCARD_DEPTH) throw new WildcardError('tooDeep', wildcard)
        const occurrence = counts.get(wildcard) ?? 0
        counts.set(wildcard, occurrence + 1)
        const line = choose(await lines(wildcard), seed, wildcard, occurrence)
        picks.push({ wildcard, line })
        out += await expand(line, depth + 1)
      }
      last = part.end
      if (out.length > MAX_EXPANDED_CHARS) throw new WildcardError('tooLong', part.wildcard || shortVariant(text.slice(part.start, part.end)))
    }
    return out + text.slice(last)
  }

  const results: string[] = []
  for (const text of texts) results.push(await expand(text, 0))
  return { texts: results, picks }
}
