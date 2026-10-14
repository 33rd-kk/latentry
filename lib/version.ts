// Latentry's own version, and the day it was released, for Settings (so the
// owner can match them against published advisories). The version is
// package.json's; the date is read from that version's heading in
// CHANGELOG.md ("## 0.8.1 (2026-10-13)"), which each release writes, so it
// is never kept twice. A checkout without CHANGELOG.md, or a version it
// does not list yet, has no date.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import packageJson from '../package.json'

export const VERSION: string = packageJson.version

let cachedDate: string | null | undefined

/** The release date of VERSION as YYYY-MM-DD, or null. Read once. */
export function releaseDate(changelog?: string): string | null {
  if (changelog === undefined && cachedDate !== undefined) return cachedDate
  let text = changelog
  if (text === undefined) {
    try {
      // A runtime file, not a source file: tell Turbopack not to trace it.
      text = readFileSync(path.resolve(/*turbopackIgnore: true*/ process.cwd(), 'CHANGELOG.md'), 'utf8')
    } catch {
      text = ''
    }
  }
  const heading = text.split(/\r?\n/).find((line) => line.startsWith(`## ${VERSION} (`))
  const date = heading ? (/^## \S+ \((\d{4}-\d{2}-\d{2})\)/.exec(heading)?.[1] ?? null) : null
  if (changelog === undefined) cachedDate = date
  return date
}
