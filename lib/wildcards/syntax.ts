// The wildcard syntax, `__name__` and `__dir/name__`, and variants in braces,
// `{a|b|c}`, with no Node imports, so the browser (the prompt box, tag
// respelling) can use it too. See ./expand.ts for what they are replaced with.

/** How deep a wildcard's line may lead to further wildcards, and a name to subfolders. */
export const MAX_WILDCARD_DEPTH = 3
/** The longest an expanded prompt may grow: a guard against files that feed each other. */
export const MAX_EXPANDED_CHARS = 20_000

/**
 * A `__name__` token. A name starts and ends with a letter or digit; between,
 * also space, `-`, `.`, `/` and single underscores, so `__a__ and __b__` is
 * two wildcards, not one named `a__ and __b`.
 */
export const TOKEN = /__([\p{L}\p{N}](?:(?:[\p{L}\p{N} \-./]|_(?!_))*[\p{L}\p{N}])?)__/gu
/** One part of a name: no path tricks, nothing Windows refuses in a file name. */
const SEGMENT = /^(?!\.{1,2}$)[^\\/:*?"<>|\u0000-\u001f]{1,128}$/

// Not global, so testing leaves no lastIndex behind for TOKEN's matchAll.
const ANY_TOKEN = new RegExp(TOKEN.source, 'u')

/** Whether `text` has any wildcard in it. */
export function hasWildcards(text: string): boolean {
  return ANY_TOKEN.test(text)
}

/**
 * A variant in braces, as the Dynamic Prompts extension writes them: `{a|b|c}`
 * takes one choice, `{2$$a|b|c}` two different ones, `{1-3$$…}` one to three,
 * `{-2$$…}` up to two and `{2-$$…}` two or more; `{2$$ and $$a|b|c}` joins
 * them with " and " instead of ", ". A choice may hold wildcards and further
 * variants. Braces with no `|` and no count, `{tag}`, are left alone, as the
 * emphasis some prompts use.
 */
export interface Variant {
  /** Where it starts (the `{`) and ends (after the `}`) in the text. */
  start: number
  end: number
  min: number
  /** Null for "as many as there are". */
  max: number | null
  separator: string
  choices: string[]
}

const VARIANT_COUNT = /^\s*(\d*)\s*(-?)\s*(\d*)\s*\$\$/
const VARIANT_SEPARATOR = /^([^$|{}]*)\$\$/

/** Splits on `mark` where no brace is open. */
function splitOutsideBraces(text: string, mark: string): string[] {
  const parts: string[] = []
  let depth = 0
  let from = 0
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '{') depth += 1
    else if (char === '}') depth = Math.max(0, depth - 1)
    else if (char === mark && depth === 0) {
      parts.push(text.slice(from, i))
      from = i + 1
    }
  }
  parts.push(text.slice(from))
  return parts
}

/** What a brace's contents ask for, or null when they are not a variant. */
function parseVariant(body: string): Omit<Variant, 'start' | 'end'> | null {
  let rest = body
  let min = 1
  let max: number | null = 1
  let separator = ', '
  const count = rest.match(VARIANT_COUNT)
  const counted = count !== null && (count[1] !== '' || count[3] !== '')
  if (counted) {
    const [, low, dash, high] = count
    min = low ? Number(low) : 0
    max = dash ? (high ? Number(high) : null) : min
    rest = rest.slice(count[0].length)
    const joiner = rest.match(VARIANT_SEPARATOR)
    if (joiner) {
      separator = joiner[1]
      rest = rest.slice(joiner[0].length)
    }
  }
  const choices = splitOutsideBraces(rest, '|').map((choice) => choice.trim())
  if (!counted && choices.length < 2) return null
  if (max !== null && max < min) [min, max] = [max, min]
  return { min, max, separator, choices }
}

/**
 * The variants in a text, outermost only, in order. A `{` that is never closed
 * is just a character.
 */
export function findVariants(text: string): Variant[] {
  const found: Variant[] = []
  let i = text.indexOf('{')
  while (i !== -1) {
    let depth = 0
    let close = -1
    for (let j = i; j < text.length; j++) {
      if (text[j] === '{') depth += 1
      else if (text[j] === '}' && --depth === 0) {
        close = j
        break
      }
    }
    const variant = close === -1 ? null : parseVariant(text.slice(i + 1, close))
    if (variant) {
      found.push({ ...variant, start: i, end: close + 1 })
      i = text.indexOf('{', close + 1)
    } else {
      // Emphasis braces, or an unclosed one: a variant may still be inside.
      i = text.indexOf('{', i + 1)
    }
  }
  return found
}

/** Whether `text` has any `{…|…}` variant in it. */
export function hasVariants(text: string): boolean {
  return text.includes('{') && findVariants(text).length > 0
}

/** Whether `text` has anything to replace before it is sent: a wildcard or a variant. */
export function hasDynamicPrompt(text: string): boolean {
  return hasWildcards(text) || hasVariants(text)
}

/** A prompt split at its commas, except those inside a variant, which is one piece. */
export function splitAtCommas(text: string): string[] {
  const variants = hasVariants(text) ? findVariants(text) : []
  const parts: string[] = []
  let from = 0
  for (let i = 0; i < text.length; i++) {
    const inside = variants.find((variant) => i >= variant.start && i < variant.end)
    if (inside) {
      i = inside.end - 1
      continue
    }
    if (text[i] === ',') {
      parts.push(text.slice(from, i))
      from = i + 1
    }
  }
  parts.push(text.slice(from))
  return parts
}

/** A wildcard's name as a path inside the folder (`/`-separated), or null when it is not a usable one. */
export function wildcardPath(name: string): string | null {
  const segments = name.split('/')
  if (segments.length > MAX_WILDCARD_DEPTH || !segments.every((segment) => SEGMENT.test(segment) && segment.trim() === segment)) return null
  return segments.join('/')
}

/** A wildcard file's choices: its lines, trimmed, without blank ones and `#` comments. */
export function wildcardLines(text: string): string[] {
  return text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
}
