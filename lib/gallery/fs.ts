// The gallery's view of its folders: listing, safe name resolution, and
// reading each picture's size and settings without loading it whole.

import { open, readdir, realpath, stat, type FileHandle } from 'node:fs/promises'
import type { BigIntStats } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { decodeTextChunk, metaFromText, PNG_SIGNATURE, type ImageMeta } from './png-meta'
import type { GalleryDir } from './dirs'
import { matchesQuery, parseQuery, searchableOf } from './query'
import { matchesCheap, matchesMeta, needsMeta, type GalleryQuery } from './filter'
import { compareEntries, DEFAULT_SORT, encodeCursor, isMetaSort, startIndex, type SortKey } from './sort'
import { indexStatus, modelsOf, withIndexValues } from './folder-index'

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
}

/**
 * Whether `name` is a plain file name the gallery may serve: no separators, no
 * `..`, nothing hidden, and an image extension. The first gate; resolveInDir
 * is the second.
 */
export function isSafeName(name: string): boolean {
  if (!name || name.length > 255) return false
  if (name !== path.basename(name) || name !== path.win32.basename(name) || name !== path.posix.basename(name)) return false
  if (name.startsWith('.') || name.includes('\0')) return false
  return IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase())
}

/**
 * The real path of `name` inside `dir`, or null. Follows symlinks and then
 * checks that the result is still directly inside the folder, so a link that
 * points elsewhere is refused rather than served.
 */
export async function resolveInDir(dir: GalleryDir, name: string): Promise<string | null> {
  if (!isSafeName(name)) return null
  try {
    const [realDir, realFile] = await Promise.all([realpath(dir.path), realpath(path.join(dir.path, name))])
    const same = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)
    if (!same(path.dirname(realFile), realDir)) return null
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
    handle = await open(file, 'r')
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

interface ListingCache {
  /** The folder's own mtime: adding or removing a file changes it. */
  dirMtime: number
  at: number
  entries: GalleryEntry[]
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
const LISTING_TTL_MS = 5 * 1000

/** Every image in the folder, newest first. Not recursive. */
export async function listEntries(dir: GalleryDir): Promise<GalleryEntry[]> {
  const dirStat = await stat(dir.path)
  const cached = listings.get(dir.path)
  if (cached && cached.dirMtime === dirStat.mtimeMs && Date.now() - cached.at < LISTING_TTL_MS) return cached.entries

  const names = (await readdir(dir.path, { withFileTypes: true }))
    .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && isSafeName(entry.name))
    .map((entry) => entry.name)

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
  entries.sort(compareEntries('newest'))
  listings.set(dir.path, { dirMtime: dirStat.mtimeMs, at: Date.now(), entries })
  return entries
}

/** Forgets a folder's listing, after a file in it was written. */
export function invalidateListing(dir: GalleryDir): void {
  listings.delete(dir.path)
}

/**
 * A PNG's size and text chunks, reading chunk headers and seeking past the
 * pixel data instead of loading the file. Text written after the image data
 * is still found; only IDAT's bytes are skipped.
 */
export async function readPngInfo(
  file: string
): Promise<{ width: number; height: number; text: Record<string, string> } | null> {
  const handle = await open(file, 'r')
  try {
    const header = Buffer.alloc(8)
    let position = 0
    const read = async (buffer: Buffer, at: number) => (await handle.read(buffer, 0, buffer.length, at)).bytesRead

    if ((await read(header, 0)) !== 8 || !header.equals(PNG_SIGNATURE)) return null
    position = 8
    let width = 0
    let height = 0
    const text: Record<string, string> = {}
    const chunkHead = Buffer.alloc(8)
    // Text chunks are small; anything claiming more than this is not worth reading.
    const MAX_TEXT_CHUNK = 8 * 1024 * 1024

    while (true) {
      if ((await read(chunkHead, position)) < 8) break
      const length = chunkHead.readUInt32BE(0)
      const type = chunkHead.toString('latin1', 4, 8)
      const dataAt = position + 8
      if (type === 'IHDR' && length >= 8) {
        const ihdr = Buffer.alloc(8)
        await read(ihdr, dataAt)
        width = ihdr.readUInt32BE(0)
        height = ihdr.readUInt32BE(4)
      } else if ((type === 'tEXt' || type === 'zTXt' || type === 'iTXt') && length <= MAX_TEXT_CHUNK) {
        const data = Buffer.alloc(length)
        await read(data, dataAt)
        const decoded = decodeTextChunk({ type, data })
        if (decoded && !(decoded.keyword in text)) text[decoded.keyword] = decoded.text
      } else if (type === 'IEND') {
        break
      }
      position = dataAt + length + 4
    }
    return { width, height, text }
  } finally {
    await handle.close()
  }
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
    if (path.extname(entry.name).toLowerCase() === '.png') {
      const info = await readPngInfo(file)
      if (info) {
        width = info.width || null
        height = info.height || null
        meta = metaFromText(info.text)
      }
    } else {
      const info = await sharp(file).metadata()
      width = info.width ?? null
      height = info.height ?? null
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
function sortedEntries(dir: GalleryDir, entries: GalleryEntry[], sort: SortKey): GalleryEntry[] {
  // listEntries already sorts newest first.
  if (sort === 'newest') return entries
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
  if (isMetaSort(sort)) {
    const status = indexStatus(dir, listing)
    if (status.state === 'too-large') return { items: [], nextCursor: null, indexing: { tooLarge: true, total: status.total } }
    if (status.state === 'indexing') return { items: [], nextCursor: null, indexing: { done: status.done, total: status.total } }
  }
  const entries = sortedEntries(dir, listing, sort).filter((entry) => matchesCheap(entry, filter, now))
  const start = startIndex(entries, options.cursor, sort)
  if (start === -1) return { items: [], nextCursor: null }

  const terms = parseQuery(filter.q ?? '')
  const filtering = terms.length > 0 || needsMeta(filter)
  const matches = (item: GalleryItem) =>
    matchesMeta(item, filter) && (terms.length === 0 || matchesQuery(searchableOf(item.name, item.meta), terms))
  const items: GalleryItem[] = []
  let index = start
  // Filtering reads metadata as it goes; a search through a huge folder stops
  // after a bounded scan and hands back a cursor to carry on from.
  const scanLimit = filtering ? 2000 : options.limit
  let scanned = 0
  while (index < entries.length && items.length < options.limit && scanned < scanLimit) {
    const batch = entries.slice(index, index + 32)
    // Only the listing's own fields: a meta order's values stay out of the reply.
    const infos = await Promise.all(batch.map(({ name, mtime, size }) => itemInfo(dir, { name, mtime, size })))
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

/** Every model named in the folder, for the model filter; or the progress while the folder is read. */
export async function listModels(dir: GalleryDir): Promise<{ models: string[] } | { models: null; indexing: IndexProgress }> {
  const listing = await listEntries(dir)
  const status = indexStatus(dir, listing)
  if (status.state === 'too-large') return { models: null, indexing: { tooLarge: true, total: status.total } }
  if (status.state === 'indexing') return { models: null, indexing: { done: status.done, total: status.total } }
  return { models: modelsOf(dir, listing) }
}
