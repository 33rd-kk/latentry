// Prompt-string helpers. A prompt here is Danbooru-style: comma-separated
// tags, spelled with spaces, possibly with prose mixed in.

/**
 * Face tags whose underscore *is* the tag: `>_<`, `0_0`, `x_x`, `^_^` and the
 * rest of the family. Every one of them is exactly three characters with the
 * underscore in the middle, which is cheaper to recognise than to enumerate --
 * and safer, since the list on Danbooru is longer than anyone remembers.
 */
const FACE_TAG = /^.[_].$/

/**
 * Spells tags with spaces, the way the form writes them: WD14 and most
 * metadata use underscores, and a prompt mixing `long hair` and `long_hair`
 * is two spellings of one tag.
 *
 * Not a blanket replace: this also runs over prompts that are tags *and*
 * prose, and over face tags a blanket replace would pull apart. An underscore
 * is only converted between two word characters, and a comma-separated token
 * that is a bare face tag is left alone entirely.
 */
export function toSpacedTags(text: string): string {
  if (!text) return text
  return text
    .split(',')
    .map((token) => (FACE_TAG.test(token.trim()) ? token : token.replace(/(?<=\w)_(?=\w)/g, ' ')))
    .join(',')
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
  const present = new Set(splitTags(existing).map((t) => t.toLowerCase()))
  const fresh: string[] = []
  for (const tag of tags) {
    const trimmed = tag.trim()
    if (!trimmed || present.has(trimmed.toLowerCase())) continue
    present.add(trimmed.toLowerCase())
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
  const present = new Set(splitTags(existing).map((t) => t.toLowerCase()))
  const fresh = tags.map((t) => t.trim()).filter((t) => t && !present.has(t.toLowerCase()))
  if (!fresh.length) return existing
  const rest = existing.trim()
  return rest ? `${fresh.join(', ')}, ${rest}` : fresh.join(', ')
}
