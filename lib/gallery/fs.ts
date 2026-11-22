// The gallery's view of its folders: listing, safe name resolution, and
// reading each picture's size and settings without loading it whole.

import { open, opendir, readdir, realpath, stat, type FileHandle } from 'node:fs/promises'
import type { BigIntStats } from 'node:fs'
import path from 'node:path'
import { metaFromText, readImageInfo, type ImageMeta } from '../image-meta'
import type { GalleryDir } from './dirs'
import { matchesQuery, parseQuery, searchableOf } from './query'
import { matchesCheap, matchesMeta, matchesStars, needsMeta, toParams, type GalleryQuery, type StackGroup } from './filter'
import { compareEntries, DEFAULT_SORT, encodeCursor, isMetaSort, startIndex, type SortKey } from './sort'
import { facetsOf, indexMatcher, indexStatus, stackKeyOf, withIndexValues, type Facets } from './folder-index'
import { dropMissingRatings, folderRatings } from './ratings'

export const IMAGE_EXTENSIONS = new Set(['.png', '.webp', '.jpg', '.jpeg'])

export interface GalleryEntry {
  name: string
  mtime: number
  size: number
}

export interface GalleryItem extends GalleryEntry {
  dir: number
  width: number | null
  height: number | null
  meta: ImageMeta | null
  /** When stacking: the stack this picture stands for, if it has others. */
  stack?: { key: string; count: number }
  /** Stars given to it (lib/gallery/ratings.ts), when it has any. */
  stars?: number
}

/**
 * Whether `name` is a plain file name the gallery may serve: no separators, no
 * `..`, nothing hidden, and an image extension. The first gate; resolveInDir
 * is the second.
 */
export function isSafeName(name: string): boolean {
  if (!name || name.length > 255) return false
  if (name !== path.basename(name) || name !== path.win32.basename(name) || name !== path.posix.basename(name)) return false
  // ':' names a Windows alternate data stream (a.txt:x.png); control characters have no place in a picture's name.
  if (name.startsWith('.') || /[\0-\x1f\x7f:]/.test(name)) return false
  return IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase())
}

/**
 * The real path of `name` inside `dir`, or null. Follows symlinks and then
 * checks that the result is still directly inside the folder, and still a
 * picture, so a link that points elsewhere (or at a program) is refused
 * rather than served or opened.
 */
export async function resolveInDir(dir: GalleryDir, name: string): Promise<string | null> {
  if (!isSafeName(name)) return null
  try {
    const [realDir, realFile] = await Promise.all([realpath(dir.path), realpath(path.join(dir.path, name))])
    const same = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)
    if (!same(path.dirname(realFile), realDir) || !IMAGE_EXTENSIONS.has(path.extname(realFile).toLowerCase())) return null
    const info = await stat(realFile)
    return info.isFile() ? realFile : null
  } catch {
    return null
  }
}

/**
 * A picture in `dir`, opened: the handle, its real path and its stats.
 *
 * Checking a path and then reading it by name leaves a gap in which the file
 * can be swapped for a symlink leading out of the folder. So the file is
 * opened first, and the open file must then be the very file the folder holds
 * under that name (same device and file id as the real path, still inside the
 * folder). Read through the handle only, and close it.
 */
export async function openInDir(
  dir: GalleryDir,
  name: string
): Promise<{ handle: FileHandle; file: string; info: BigIntStats } | null> {
  const file = await resolveInDir(dir, name)
  if (!file) return null
  let handle: FileHandle | null = null
  try {
    // A picture in a gallery folder, never a source file: not for Turbopack to trace.
    handle = await open(/*turbopackIgnore: true*/ file, 'r')
    const [info, again] = await Promise.all([handle.stat({ bigint: true }), resolveInDir(dir, name)])
    const there = again ? await stat(again, { bigint: true }) : null
    if (!there || !info.isFile() || info.dev !== there.dev || info.ino !== there.ino) {
      await handle.close()
      return null
    }
    return { handle, file, info }
  } catch {
    await handle?.close().catch(() => {})
    return null
  }
}

/** A picture in `dir`, read whole through openInDir; its real path and bytes, or null. */
export async function readInDir(dir: GalleryDir, name: string): Promise<{ file: string; bytes: Buffer } | null> {
  const opened = await openInDir(dir, name)
  if (!opened) return null
  try {
    return { file: opened.file, bytes: await opened.handle.readFile() }
  } finally {
    await opened.handle.close()
  }
}

interface ListingCache {
  /** The folder's own mtime: adding or removing a file changes it. */
  dirMtime: number
  /** When every file in it was last looked at (stat). */
  at: number
  entries: GalleryEntry[]
  byName: Map<string, GalleryEntry>
  /** Files Latentry wrote since: looked at again on the next listing. */
  dirty: Set<string>
  /** A full listing running in the background, for a large folder. */
  refreshing: Promise<void> | null
}

const globalForGallery = globalThis as typeof globalThis & {
  __galleryListings?: Map<string, ListingCache>
  __galleryInfo?: Map<string, { key: string; width: number | null; height: number | null; meta: ImageMeta | null }>
}
const listings = (globalForGallery.__galleryListings ??= new Map())
const infoCache = (globalForGallery.__galleryInfo ??= new Map())
const INFO_CACHE_MAX = 20000
// A file rewritten in place (tags written back) keeps the folder's mtime on
// some filesystems, so a listing is never trusted for long.
let listingTtlMs = 5 * 1000
/**
 * From this many pictures, looking at every file again (a stat each, about
 * 5 s for 300,000) is not done while a request waits. The folder's names are
 * read (fast), new and rewritten files are looked at, and the others keep
 * what was known; a full look runs in the background once listingTtlMs
 * has passed, and the next request gets its result.
 */
export const LARGE_LISTING = 5000
let largeListing = LARGE_LISTING

/** For the verify script: a small "large" folder and a short wait, instead of thousands of files. */
export function setListingLimits(limits: { large?: number; ttlMs?: number }): void {
  largeListing = limits.large ?? LARGE_LISTING
  listingTtlMs = limits.ttlMs ?? 5 * 1000
}

/** Waits for the folder's background listing, if one runs. For the verify script. */
export async function settleListing(dir: GalleryDir): Promise<void> {
  await listings.get(dir.path)?.refreshing
}

async function statEntries(dir: GalleryDir, names: string[]): Promise<GalleryEntry[]> {
  const entries: GalleryEntry[] = []
  // In slices, so a folder of ten thousand files does not open them all at once.
  for (let start = 0; start < names.length; start += 64) {
    const slice = await Promise.all(
      names.slice(start, start + 64).map(async (name) => {
        try {
          const info = await stat(path.join(dir.path, name))
          return info.isFile() ? { name, mtime: info.mtimeMs, size: info.size } : null
        } catch {
          return null
        }
      })
    )
    for (const entry of slice) if (entry) entries.push(entry)
  }
  return entries
}

async function readNames(dir: GalleryDir): Promise<string[]> {
  return (await readdir(dir.path, { withFileTypes: true }))
    .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && isSafeName(entry.name))
    .map((entry) => entry.name)
}

function remember(dir: GalleryDir, dirMtime: number, at: number, entries: GalleryEntry[]): GalleryEntry[] {
  entries.sort(compareEntries('newest'))
  const previous = listings.get(dir.path)
  listings.set(dir.path, {
    dirMtime,
    at,
    entries,
    byName: new Map(entries.map((entry) => [entry.name, entry])),
    dirty: new Set(),
    refreshing: previous?.refreshing ?? null,
  })
  // Ratings of files no longer here go. Not when the folder looks empty: a
  // drive that is not there yet should not take every rating with it.
  if (entries.length) {
    dropMissingRatings(dir.path, new Set(entries.map((entry) => entry.name))).catch((error) =>
      console.error('[ratings] could not drop those of missing files:', error instanceof Error ? error.message : error)
    )
  }
  return entries
}

/** Looks at every file again, in the background; the next listing gets the result. */
function refreshInBackground(dir: GalleryDir, cached: ListingCache): void {
  if (cached.refreshing) return
  cached.refreshing = (async () => {
    const dirMtime = (await stat(dir.path)).mtimeMs
    const at = Date.now()
    const entries = await statEntries(dir, await readNames(dir))
    const now = listings.get(dir.path)
    // Something Latentry wrote meanwhile is looked at by the next listing.
    const dirty = now?.dirty ?? new Set<string>()
    remember(dir, dirMtime, at, entries)
    const fresh = listings.get(dir.path)
    if (fresh) for (const name of dirty) fresh.dirty.add(name)
  })()
    .catch((error) => console.error('Gallery listing failed:', error instanceof Error ? error.message : error))
    .finally(() => {
      const now = listings.get(dir.path)
      if (now) now.refreshing = null
    })
}

/** Every image in the folder, newest first. Not recursive. */
export async function listEntries(dir: GalleryDir): Promise<GalleryEntry[]> {
  const dirStat = await stat(dir.path)
  const cached = listings.get(dir.path)
  const fresh = cached !== undefined && Date.now() - cached.at < listingTtlMs
  const large = cached !== undefined && cached.entries.length >= largeListing
  if (cached && cached.dirMtime === dirStat.mtimeMs && cached.dirty.size === 0) {
    if (fresh) return cached.entries
    if (large) {
      refreshInBackground(dir, cached)
      return cached.entries
    }
  }
  if (!cached || !large) return remember(dir, dirStat.mtimeMs, Date.now(), await statEntries(dir, await readNames(dir)))

  // A large folder that changed: only new and rewritten files are looked at.
  const names = await readNames(dir)
  const known: GalleryEntry[] = []
  const unknown: string[] = []
  for (const name of names) {
    const entry = cached.byName.get(name)
    if (entry && !cached.dirty.has(name)) known.push(entry)
    else unknown.push(name)
  }
  const entries = [...known, ...(await statEntries(dir, unknown))]
  remember(dir, dirStat.mtimeMs, cached.at, entries)
  if (!fresh) refreshInBackground(dir, listings.get(dir.path)!)
  return entries
}

/**
 * Whether the folder holds at least one picture. Stops at the first one, so
 * a large folder is not read through; a folder that is not there has none.
 */
export async function hasPictures(dir: GalleryDir): Promise<boolean> {
  const cached = listings.get(dir.path)
  if (cached && Date.now() - cached.at < listingTtlMs) return cached.entries.length > 0
  try {
    // The loop closes the folder when it ends, by return or otherwise.
    for await (const entry of await opendir(dir.path)) {
      if ((entry.isFile() || entry.isSymbolicLink()) && isSafeName(entry.name)) return true
    }
    return false
  } catch {
    return false
  }
}

/**
 * After Latentry wrote a file in the folder: that file is looked at again on
 * the next listing. Without a name, the whole listing is forgotten.
 */
export function invalidateListing(dir: GalleryDir, name?: string): void {
  const cached = listings.get(dir.path)
  if (name !== undefined && cached) cached.dirty.add(name)
  else listings.delete(dir.path)
}

/** Size and settings for one listed file, cached until the file changes. */
export async function itemInfo(dir: GalleryDir, entry: GalleryEntry): Promise<GalleryItem> {
  const file = path.join(dir.path, entry.name)
  const key = `${entry.mtime}:${entry.size}`
  const cached = infoCache.get(file)
  if (cached?.key === key) return { ...entry, dir: dir.index, width: cached.width, height: cached.height, meta: cached.meta }

  let width: number | null = null
  let height: number | null = null
  let meta: ImageMeta | null = null
  try {
    // Headers only, for every format; the pixels are never decoded here.
    const info = await readImageInfo(file)
    if (info) {
      width = info.width || null
      height = info.height || null
      meta = metaFromText(info.text)
    }
  } catch {
    // An unreadable file still gets a card; it just has nothing to say.
  }

  if (infoCache.size >= INFO_CACHE_MAX) {
    // Drop the oldest tenth; Map iterates in insertion order.
    let drop = Math.ceil(INFO_CACHE_MAX / 10)
    for (const stale of infoCache.keys()) {
      infoCache.delete(stale)
      if (--drop <= 0) break
    }
  }
  infoCache.set(file, { key, width, height, meta })
  return { ...entry, dir: dir.index, width, height, meta }
}

// Each listing sorted in the other orders, made when first asked for. Keyed
// by the listing itself, so a new listing starts without them.
const sortedListings = new WeakMap<GalleryEntry[], Map<SortKey, GalleryEntry[]>>()

/** The listing in `sort`'s order. A meta order needs the folder's index ready first. */
function sortedEntries(dir: GalleryDir, entries: GalleryEntry[], sort: SortKey, stars: ReadonlyMap<string, number>): GalleryEntry[] {
  // listEntries already sorts newest first.
  if (sort === 'newest') return entries
  // Ratings change without the listing changing, so this order is not kept.
  if (sort === 'stars-desc') {
    return entries.map((entry) => ({ ...entry, stars: stars.get(entry.name) ?? 0 })).sort(compareEntries(sort))
  }
  let orders = sortedListings.get(entries)
  if (!orders) sortedListings.set(entries, (orders = new Map()))
  let sorted = orders.get(sort)
  if (!sorted) {
    const source = isMetaSort(sort) ? withIndexValues(dir, entries) : [...entries]
    orders.set(sort, (sorted = source.sort(compareEntries(sort))))
  }
  return sorted
}

/** While a meta order waits for the folder's index: how far it has got, or that the folder is too large. */
export type IndexProgress = { done: number; total: number } | { tooLarge: true; total: number }

export interface GalleryPage {
  items: GalleryItem[]
  nextCursor: string | null
  /** Set instead of items while the folder is being read for a meta order; ask again. */
  indexing?: IndexProgress
}

/** One page of a folder in the query's order, after `cursor`, matching the query. */
export async function listPage(
  dir: GalleryDir,
  options: { cursor?: string | null; limit: number; filter: GalleryQuery }
): Promise<GalleryPage> {
  const { filter } = options
  const sort = filter.sort ?? DEFAULT_SORT
  const now = Date.now()
  // Age and file type need no file opened, so they narrow the list first.
  const listing = await listEntries(dir)
  // Meta orders and stacks need the whole folder read first.
  if (isMetaSort(sort) || filter.group) {
    const status = indexStatus(dir, listing)
    if (status.state === 'too-large') return { items: [], nextCursor: null, indexing: { tooLarge: true, total: status.total } }
    if (status.state === 'indexing') return { items: [], nextCursor: null, indexing: { done: status.done, total: status.total } }
  }
  const stars = folderRatings(dir.path)
  const starsOf = (name: string) => stars.get(name) ?? 0
  let entries = sortedEntries(dir, listing, sort, stars).filter((entry) => matchesCheap(entry, filter, now) && matchesStars(starsOf(entry.name), filter))
  const { group, stack } = filter
  // Inside one stack: only its pictures, unstacked.
  if (group && stack) entries = entries.filter((entry) => stackKeyOf(dir, entry.name, group) === stack)

  const terms = parseQuery(filter.q ?? '')
  let filtering = terms.length > 0 || needsMeta(filter)
  // Once the folder is indexed, the index answers the search and filters
  // without opening a file; until then (and the first search starts the
  // index) the files are read as the page is scanned.
  const fromIndex = filtering ? indexMatcher(dir, listing, filter, terms) : null
  if (fromIndex) {
    entries = entries.filter(fromIndex)
    filtering = false
  }
  const matches = (item: GalleryItem) =>
    matchesMeta(item, filter) && (terms.length === 0 || matchesQuery(searchableOf(item.name, item.meta, item), terms))
  if (group && !stack) return stackedPage(dir, listing, entries, { ...options, sort, group, stars, matches: filtering ? matches : null })

  const start = startIndex(entries, options.cursor, sort)
  if (start === -1) return { items: [], nextCursor: null }
  const items: GalleryItem[] = []
  let index = start
  // Filtering reads metadata as it goes; a search through a huge folder stops
  // after a bounded scan and hands back a cursor to carry on from.
  const scanLimit = filtering ? 2000 : options.limit
  let scanned = 0
  while (index < entries.length && items.length < options.limit && scanned < scanLimit) {
    const batch = entries.slice(index, index + 32)
    // Only the listing's own fields: a meta order's values stay out of the reply.
    const infos = (await Promise.all(batch.map(({ name, mtime, size }) => itemInfo(dir, { name, mtime, size })))).map((item) => withStars(item, stars))
    for (let i = 0; i < infos.length; i += 1) {
      index += 1
      scanned += 1
      if (!filtering || matches(infos[i])) items.push(infos[i])
      if (items.length >= options.limit || scanned >= scanLimit) break
    }
  }
  const last = entries[index - 1]
  return { items, nextCursor: index < entries.length && last ? encodeCursor(last, sort) : null }
}

interface Stacked {
  /** One picture per stack (the first in the order), and every picture without a key. */
  entries: GalleryEntry[]
  stacks: Map<string, { key: string; count: number }>
}

// Stacking looks at every matching picture, so its result is kept per
// listing and query (a few of them), and paging through it costs nothing.
const stackedListings = new WeakMap<GalleryEntry[], Map<string, Stacked>>()
const STACKED_KEEP = 4

/**
 * One page of stacks. A stack stands for the pictures that share a prompt
 * (or seed) and match the search and filters; it shows the first of them in
 * the order, with their count. Every picture's settings are already cached
 * once the folder is indexed, so reading them all is quick.
 */
async function stackedPage(
  dir: GalleryDir,
  listing: GalleryEntry[],
  entries: GalleryEntry[],
  options: {
    cursor?: string | null
    limit: number
    filter: GalleryQuery
    sort: SortKey
    group: StackGroup
    stars: ReadonlyMap<string, number>
    matches: ((item: GalleryItem) => boolean) | null
  }
): Promise<GalleryPage> {
  // The ratings themselves are part of the key: giving stars changes the stars filter and order.
  const cacheKey = `${toParams(options.filter)}|${options.filter.minStars || options.sort === 'stars-desc' ? JSON.stringify([...options.stars]) : ''}`
  let cached = stackedListings.get(listing)
  if (!cached) stackedListings.set(listing, (cached = new Map()))
  let stacked = cached.get(cacheKey)
  if (!stacked) {
    stacked = { entries: [], stacks: new Map() }
    const firstOf = new Map<string, string>()
    for (let start = 0; start < entries.length; start += 64) {
      const batch = entries.slice(start, start + 64)
      // With nothing to match (or matched from the index already), only the names are needed.
      const matches = options.matches
      const infos = matches
        ? await Promise.all(batch.map(({ name, mtime, size }) => itemInfo(dir, { name, mtime, size })))
        : batch
      infos.forEach((info, i) => {
        if (matches && !matches(info as GalleryItem)) return
        const key = stackKeyOf(dir, info.name, options.group)
        const first = key === undefined ? undefined : firstOf.get(key)
        if (key === undefined || first === undefined) {
          stacked!.entries.push(batch[i])
          if (key !== undefined) {
            firstOf.set(key, info.name)
            stacked!.stacks.set(info.name, { key, count: 1 })
          }
        } else {
          stacked!.stacks.get(first)!.count += 1
        }
      })
    }
    if (cached.size >= STACKED_KEEP) cached.delete(cached.keys().next().value!)
    cached.set(cacheKey, stacked)
  }

  const start = startIndex(stacked.entries, options.cursor, options.sort)
  if (start === -1) return { items: [], nextCursor: null }
  const page = stacked.entries.slice(start, start + options.limit)
  const items = await Promise.all(
    page.map(async ({ name, mtime, size }) => {
      const item = withStars(await itemInfo(dir, { name, mtime, size }), options.stars)
      const stack = stacked!.stacks.get(name)
      return stack && stack.count > 1 ? { ...item, stack: { ...stack } } : item
    })
  )
  const end = start + page.length
  const last = stacked.entries[end - 1]
  return { items, nextCursor: end < stacked.entries.length && last ? encodeCursor(last, options.sort) : null }
}

function withStars(item: GalleryItem, stars: ReadonlyMap<string, number>): GalleryItem {
  const given = stars.get(item.name)
  return given ? { ...item, stars: given } : item
}

/** Every model and LoRA named in the folder, for the filters; or the progress while the folder is read. */
export async function listFacets(dir: GalleryDir): Promise<{ facets: Facets } | { facets: null; indexing: IndexProgress }> {
  const listing = await listEntries(dir)
  const status = indexStatus(dir, listing)
  if (status.state === 'too-large') return { facets: null, indexing: { tooLarge: true, total: status.total } }
  if (status.state === 'indexing') return { facets: null, indexing: { done: status.done, total: status.total } }
  return { facets: facetsOf(dir, listing) }
}
