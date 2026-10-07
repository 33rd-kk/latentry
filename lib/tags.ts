// Prompt-string helpers. A prompt here is Danbooru-style: comma-separated
// tags, possibly with prose mixed in. How a tag spells its word breaks --
// `long_hair` or `long hair` -- depends on what the model was trained on, so
// that is the profile's call (lib/profiles), and formatTags does the work.

/** How a profile writes the word breaks inside a tag; `asis` leaves them. */
export const TAG_STYLES = ['underscore', 'space', 'asis'] as const
export type TagStyle = (typeof TAG_STYLES)[number]

export function isTagStyle(value: unknown): value is TagStyle {
  return typeof value === 'string' && (TAG_STYLES as readonly string[]).includes(value)
}

/**
 * Face tags whose underscore *is* the tag: `>_<`, `0_0`, `x_x`, `^_^` and the
 * rest of the family. Every one of them is exactly three characters with the
 * underscore in the middle, which is cheaper to recognise than to enumerate --
 * and safer, since the list on Danbooru is longer than anyone remembers.
 */
const FACE_TAG = /^.[_].$/

/** A tag inside A1111 weighting: `(long hair:1.2)`, `[[blurry]]`. */
const WEIGHTED = /^([([{]*)([\s\S]*?)((?::-?\d*\.?\d+)?[)\]}]*)$/

/**
 * Text that reads as a sentence rather than a tag. Joining its words with
 * underscores would turn it into one long tag nobody trained on.
 */
function isProse(body: string): boolean {
  return /[.!?;]/.test(body) || body.split(/[ \t]+/).length >= 5
}

/** `keep` as a test: comma-separated patterns, `*` for any run of characters. */
function keepTest(keep: string): (tag: string) => boolean {
  const escape = (part: string) => part.replace(/[.*+?^$()|[\]{}\\]/g, '\\$&')
  const patterns = splitTags(keep).map((pattern) => new RegExp('^' + pattern.split('*').map(escape).join('.*') + '$', 'i'))
  return (tag) => patterns.some((pattern) => pattern.test(tag))
}

function formatToken(token: string, style: Exclude<TagStyle, 'asis'>, kept: (tag: string) => boolean): string {
  const core = token.trim()
  if (!core) return token
  const [, open, body, close] = core.match(WEIGHTED) ?? ['', '', core, '']
  // LoRA and embedding calls, BREAK, face tags and the profile's own list are
  // spelled exactly as they must be.
  if (!body || body.startsWith('<') || /\bBREAK\b/.test(body) || FACE_TAG.test(body) || kept(body)) return token
  const converted =
    style === 'space'
      ? // Only between word characters (or before a tag's `(qualifier)`), so
        // `_leading` and `snake_` in prose stay.
        body.replace(/(?<=\w)_(?=\w|\\?\()/g, ' ')
      : isProse(body)
        ? body
        : body.replace(/[ \t]+/g, '_')
  if (converted === body) return token
  const start = token.indexOf(core)
  return token.slice(0, start) + open + converted + close + token.slice(start + core.length)
}

/**
 * Writes every tag of a prompt in `style`: `long hair` and `long_hair` are
 * one tag in two spellings, and a model reads the one it was trained on.
 * Tabs count as spaces. Tags matching `keep` (comma-separated, `*` a
 * wildcard, e.g. `score_*`) are left exactly as written, and so are face
 * tags, LoRA calls, BREAK and, for underscores, anything that reads as prose.
 */
export function formatTags(text: string, style: TagStyle, keep = ''): string {
  if (!text || style === 'asis') return text
  const kept = keepTest(keep)
  return text
    .replace(/\t/g, ' ')
    .split(',')
    .map((token) => formatToken(token, style, kept))
    .join(',')
}

/** Spells tags with spaces, the way the gallery shows them. */
export function toSpacedTags(text: string): string {
  return formatTags(text, 'space')
}

/** What makes two tags the same: case, and `_` versus space, do not count. */
export function tagKey(tag: string): string {
  return tag.trim().toLowerCase().replace(/[ _]+/g, ' ')
}

/** The comma-separated tokens of a prompt, trimmed, empties dropped. */
export function splitTags(prompt: string): string[] {
  return prompt
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

/** Appends a tag to a prompt, skipping it if already present. */
export function appendTag(existing: string, tag: string): string {
  return appendTags(existing, [tag])
}

/**
 * Appends tags to a prompt, skipping any it already has and any repeated
 * among the new ones, so a whole section can be sent over a prompt in progress.
 */
export function appendTags(existing: string, tags: string[]): string {
  const present = new Set(splitTags(existing).map(tagKey))
  const fresh: string[] = []
  for (const tag of tags) {
    const trimmed = tag.trim()
    if (!trimmed || present.has(tagKey(trimmed))) continue
    present.add(tagKey(trimmed))
    fresh.push(trimmed)
  }
  if (!fresh.length) return existing
  const rest = existing.trim()
  return rest ? `${rest}, ${fresh.join(', ')}` : fresh.join(', ')
}

/**
 * Puts tags in front of a prompt, skipping any it already has — a saved
 * character's tags lead, and the scene the user has written follows.
 */
export function prependTags(existing: string, tags: string[]): string {
  const present = new Set(splitTags(existing).map(tagKey))
  const fresh = tags.map((t) => t.trim()).filter((t) => t && !present.has(tagKey(t)))
  if (!fresh.length) return existing
  const rest = existing.trim()
  return rest ? `${fresh.join(', ')}, ${rest}` : fresh.join(', ')
}
