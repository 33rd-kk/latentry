// The stars (1–5) given to gallery pictures.
//
// Their own file next to the settings file (latentry.ratings.json), never the
// picture: a shared picture does not carry what you thought of it, and a
// picture in a read-only folder can be rated too. Owner-only, like the other
// files there, since folder paths and file names say what is on this computer.
//
// A rating belongs to a folder and a file name. Not to the file's size or
// time: writing tags into a picture changes both. A renamed picture loses its
// stars, and those of files no longer in their folder are dropped the next
// time it is listed.
//
// Server-side only. The checks are pure, so the verify script can pin them down.

import { randomBytes } from 'node:crypto'
import { closeSync, fstatSync, openSync, readFileSync } from 'node:fs'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { restrictExistingToOwner, restrictToOwner } from '@/lib/security/owner-only'
import { settingsPath } from '@/lib/settings/store'
import { folderKey } from './dirs'

type Env = Record<string, string | undefined>

export const RATINGS_VERSION = 1
/** Rated pictures in all, across every folder. */
export const MAX_RATINGS = 100_000
export const MAX_STARS = 5
const MAX_NAME_LENGTH = 255
const MAX_FOLDER_LENGTH = 4096

/** Folder key (dirs.ts folderKey) → file name → stars. */
export type Ratings = Map<string, Map<string, number>>

/** 1–5, or null for anything else (0 means "no rating" and is never stored). */
export function validStars(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_STARS ? value : null
}

function validName(value: string): boolean {
  return value.length > 0 && value.length <= MAX_NAME_LENGTH && !/[\0-\x1f\x7f/\\]/.test(value)
}

/** What a stored file holds, keeping only well-formed entries, up to MAX_RATINGS. */
export function parseStoredRatings(raw: unknown): Ratings {
  const out: Ratings = new Map()
  const folders = (raw as { folders?: unknown } | null)?.folders
  if (!folders || typeof folders !== 'object' || Array.isArray(folders)) return out
  let count = 0
  for (const [folder, files] of Object.entries(folders)) {
    if (!folder || folder.length > MAX_FOLDER_LENGTH || !files || typeof files !== 'object' || Array.isArray(files)) continue
    const kept = new Map<string, number>()
    for (const [name, value] of Object.entries(files)) {
      const stars = validStars(value)
      if (stars === null || !validName(name)) continue
      if (count >= MAX_RATINGS) break
      kept.set(name, stars)
      count += 1
    }
    if (kept.size) out.set(folder, kept)
  }
  return out
}

function countOf(ratings: Ratings): number {
  let count = 0
  for (const files of ratings.values()) count += files.size
  return count
}

/** Thrown when a new rating would take the file past MAX_RATINGS. */
export class TooManyRatingsError extends Error {
  constructor() {
    super(`At most ${MAX_RATINGS} rated pictures`)
    this.name = 'TooManyRatingsError'
  }
}

/**
 * `ratings` with `name` in `folder` given `stars` (0 removes it). A copy; the
 * same object when nothing changes.
 */
export function withRating(ratings: Ratings, folder: string, name: string, stars: number): Ratings {
  const current = ratings.get(folder)?.get(name) ?? 0
  if (current === stars) return ratings
  if (stars && !current && countOf(ratings) >= MAX_RATINGS) throw new TooManyRatingsError()
  const next: Ratings = new Map(ratings)
  const files = new Map(next.get(folder))
  if (stars) files.set(name, stars)
  else files.delete(name)
  if (files.size) next.set(folder, files)
  else next.delete(folder)
  return next
}

/** `ratings` without the files of `folder` that are not in `present`; the same object when none go. */
export function withoutMissing(ratings: Ratings, folder: string, present: ReadonlySet<string>): Ratings {
  const files = ratings.get(folder)
  if (!files) return ratings
  const kept = new Map([...files].filter(([name]) => present.has(name)))
  if (kept.size === files.size) return ratings
  const next: Ratings = new Map(ratings)
  if (kept.size) next.set(folder, kept)
  else next.delete(folder)
  return next
}

export function ratingsPath(env: Env = process.env): string {
  return path.join(path.dirname(settingsPath(env)), 'latentry.ratings.json')
}

const globalForRatings = globalThis as typeof globalThis & {
  __latentryRatings?: { file: string; mtime: number; ratings: Ratings; version: number | null }
  __latentryRatingsWrites?: Promise<unknown>
}

function readFile(env: Env): { ratings: Ratings; version: number | null } {
  const file = ratingsPath(env)
  let fd: number
  try {
    fd = openSync(/*turbopackIgnore: true*/ file, 'r')
  } catch {
    return { ratings: new Map(), version: null }
  }
  restrictExistingToOwner(file)
  try {
    const mtime = fstatSync(fd).mtimeMs
    const cached = globalForRatings.__latentryRatings
    if (cached && cached.file === file && cached.mtime === mtime) return cached
    let ratings: Ratings = new Map()
    let version: number | null = null
    try {
      const raw = JSON.parse(readFileSync(fd, 'utf8'))
      ratings = parseStoredRatings(raw)
      version = typeof raw?.version === 'number' && Number.isFinite(raw.version) ? raw.version : null
    } catch (error) {
      console.error(`[ratings] could not read ${path.basename(file)}:`, error instanceof Error ? error.message : error)
    }
    globalForRatings.__latentryRatings = { file, mtime, ratings, version }
    return { ratings, version }
  } finally {
    closeSync(fd)
  }
}

/** The stars of one gallery folder's pictures, by file name. Re-read only when the file changes. */
export function folderRatings(folder: string, env: Env = process.env): ReadonlyMap<string, number> {
  return readFile(env).ratings.get(folderKey(folder)) ?? new Map()
}

/** Thrown when the file was written by a newer Latentry: writing it back could drop what this release does not know. */
export class NewerRatingsError extends Error {
  constructor(readonly version: number) {
    super(`latentry.ratings.json is version ${version}; this Latentry writes version ${RATINGS_VERSION}`)
    this.name = 'NewerRatingsError'
  }
}

/** One write at a time, so two ratings given at once both stay. */
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = (globalForRatings.__latentryRatingsWrites ?? Promise.resolve()).then(task, task)
  globalForRatings.__latentryRatingsWrites = run.catch(() => {})
  return run
}

// Windows refuses to rename over a file another process has open for a moment
// (a reader, a virus scanner): EPERM, EBUSY or EACCES. It clears quickly.
const BUSY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])
const RENAME_TRIES = 8

async function renameOver(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (attempt >= RENAME_TRIES || !code || !BUSY_CODES.has(code)) throw error
      await new Promise((resolve) => setTimeout(resolve, 25 * attempt))
    }
  }
}

async function update(env: Env, change: (ratings: Ratings) => Ratings): Promise<void> {
  const file = ratingsPath(env)
  const { ratings, version } = readFile(env)
  if (version !== null && version > RATINGS_VERSION) throw new NewerRatingsError(version)
  const next = change(ratings)
  if (next === ratings) return
  const folders: Record<string, Record<string, number>> = {}
  for (const [folder, files] of next) folders[folder] = Object.fromEntries(files)
  await mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${randomBytes(4).toString('hex')}.tmp`
  try {
    await writeFile(temp, JSON.stringify({ version: RATINGS_VERSION, folders }) + '\n', { mode: 0o600 })
    restrictToOwner(temp)
    await renameOver(temp, file)
  } catch (error) {
    await unlink(temp).catch(() => {})
    throw error
  }
  delete globalForRatings.__latentryRatings
}

/** Gives `name` in `folder` 1–5 stars, or takes its rating away with 0. Atomic and owner-only. */
export function setRating(folder: string, name: string, stars: number, env: Env = process.env): Promise<void> {
  if (stars !== 0 && validStars(stars) === null) throw new RangeError('stars must be 0–5')
  if (!validName(name)) throw new RangeError('Not a file name')
  return serialized(() => update(env, (ratings) => withRating(ratings, folderKey(folder), name, stars)))
}

/** Drops the ratings of files no longer in `folder`. Nothing is written when none go. */
export function dropMissingRatings(folder: string, present: ReadonlySet<string>, env: Env = process.env): Promise<void> {
  const key = folderKey(folder)
  // Most folders have no ratings at all: then not even the queue is joined.
  if (!readFile(env).ratings.get(key)?.size) return Promise.resolve()
  return serialized(() => update(env, (ratings) => withoutMissing(ratings, key, present)))
}
