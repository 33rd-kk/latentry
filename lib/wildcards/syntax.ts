// The wildcard syntax, `__name__` and `__dir/name__`, with no Node imports,
// so the browser (the prompt box, tag respelling) can use it too. See
// ./expand.ts for what a wildcard is replaced with.

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
