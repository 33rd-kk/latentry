// Wildcards in a prompt: `__name__` is replaced by one line of the wildcard
// file `name.txt`, as in the Dynamic Prompts extension for A1111 (whose file
// layout this follows, so an existing wildcards folder works as it is):
// `__dir/name__` reads from a subfolder, and a picked line may hold
// wildcards of its own.
//
// Pure apart from the reader it is given, and free of Latentry imports, so it
// can be split out on its own. Server only (node:crypto); ./syntax.ts is the
// part the browser may use.

import { createHash, randomInt } from 'node:crypto'
import { MAX_EXPANDED_CHARS, MAX_WILDCARD_DEPTH, TOKEN, wildcardPath } from './syntax'

export type WildcardProblem = 'unknown' | 'empty' | 'tooDeep' | 'tooLong'

export class WildcardError extends Error {
  constructor(
    readonly problem: WildcardProblem,
    /** The wildcard that caused it, as written between the underscores. */
    readonly wildcard: string
  ) {
    super(`${problem}: __${wildcard}__`)
    this.name = 'WildcardError'
  }
}

/** A wildcard file's lines by name, or null when there is no such file. */
export type WildcardReader = (path: string) => Promise<string[] | null>

export interface Pick {
  wildcard: string
  line: string
}

/**
 * Which line to take. With a seed (0 or more) the same seed, wildcard and
 * occurrence always take the same line, so a run can be drawn again; with -1,
 * a random one.
 */
function choose(lines: string[], seed: number, wildcard: string, occurrence: number): string {
  if (seed < 0) return lines[randomInt(lines.length)]
  const digest = createHash('sha256').update(`${seed}\u0000${wildcard}\u0000${occurrence}`).digest()
  return lines[digest.readUIntBE(0, 6) % lines.length]
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

  const expand = async (text: string, depth: number): Promise<string> => {
    let out = ''
    let last = 0
    for (const match of text.matchAll(TOKEN)) {
      const wildcard = match[1]
      if (depth >= MAX_WILDCARD_DEPTH) throw new WildcardError('tooDeep', wildcard)
      const occurrence = counts.get(wildcard) ?? 0
      counts.set(wildcard, occurrence + 1)
      const line = choose(await lines(wildcard), seed, wildcard, occurrence)
      picks.push({ wildcard, line })
      out += text.slice(last, match.index) + (await expand(line, depth + 1))
      last = match.index + match[0].length
      if (out.length > MAX_EXPANDED_CHARS) throw new WildcardError('tooLong', wildcard)
    }
    return out + text.slice(last)
  }

  const results: string[] = []
  for (const text of texts) results.push(await expand(text, 0))
  return { texts: results, picks }
}
