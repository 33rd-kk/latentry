// What the gallery knows about every picture in a folder at once: when it was
// made, its pixel count, and the model named in its settings.
// The orders by date made and by size, and the full list of models for the
// filter, need this for the whole folder before the first page.
//
// Built by reading each file's header (itemInfo, which caches), a slice at a
// time and in the background, so a request never waits on a large folder: it
// gets the progress instead and asks again. A picture is read once; a new or
// changed file is read on the next build, and only that file.
//
// Held in this process's memory only and never written anywhere. No prompts
// are kept, only the few fields above.

import type { GalleryDir } from './dirs'
import { itemInfo, type GalleryEntry } from './fs'

/** Folders larger than this are not indexed; the meta orders say so instead. */
export const INDEX_MAX = 20000

interface IndexRecord {
  /** mtime:size of the file this was read from; another value means it changed. */
  key: string
  created: number
  pixels: number
  model?: string
}

interface FolderIndex {
  records: Map<string, IndexRecord>
  building: Promise<void> | null
  done: number
  total: number
}

const globalForIndex = globalThis as typeof globalThis & { __galleryIndex?: Map<string, FolderIndex> }
const indexes = (globalForIndex.__galleryIndex ??= new Map())

export type IndexStatus =
  | { state: 'ready' }
  | { state: 'indexing'; done: number; total: number }
  | { state: 'too-large'; total: number }

function keyOf(entry: GalleryEntry): string {
  return `${entry.mtime}:${entry.size}`
}

function indexFor(dir: GalleryDir): FolderIndex {
  let index = indexes.get(dir.path)
  if (!index) indexes.set(dir.path, (index = { records: new Map(), building: null, done: 0, total: 0 }))
  return index
}

function isCurrent(index: FolderIndex, entry: GalleryEntry): boolean {
  return index.records.get(entry.name)?.key === keyOf(entry)
}

async function build(dir: GalleryDir, index: FolderIndex, entries: GalleryEntry[]): Promise<void> {
  const missing = entries.filter((entry) => !isCurrent(index, entry))
  index.total = entries.length
  index.done = entries.length - missing.length
  for (let start = 0; start < missing.length; start += 32) {
    const slice = missing.slice(start, start + 32)
    const infos = await Promise.all(slice.map((entry) => itemInfo(dir, entry)))
    for (const info of infos) {
      const created = Date.parse(info.meta?.created ?? '')
      index.records.set(info.name, {
        key: keyOf(info),
        created: Number.isFinite(created) ? created : info.mtime,
        pixels: info.width && info.height ? info.width * info.height : 0,
        model: info.meta?.model,
      })
    }
    index.done += slice.length
  }
  // Files that are gone are forgotten.
  const names = new Set(entries.map((entry) => entry.name))
  for (const name of index.records.keys()) if (!names.has(name)) index.records.delete(name)
}

/**
 * Whether the folder's index covers `entries` (its current listing). If it
 * does not, a build starts in the background (one per folder at a time) and
 * the progress so far is returned.
 */
export function indexStatus(dir: GalleryDir, entries: GalleryEntry[]): IndexStatus {
  if (entries.length > INDEX_MAX) return { state: 'too-large', total: entries.length }
  const index = indexFor(dir)
  if (!index.building && entries.every((entry) => isCurrent(index, entry))) return { state: 'ready' }
  if (!index.building) {
    index.building = build(dir, index, entries)
      .catch((error) => console.error('Gallery index failed:', error))
      .finally(() => {
        index.building = null
      })
  }
  return { state: 'indexing', done: index.done, total: index.total }
}

/** Waits for the folder's current build, if any. For the verify script. */
export async function settleIndex(dir: GalleryDir): Promise<void> {
  await indexes.get(dir.path)?.building
}

/** The listing with each entry's date made and pixel count, for the meta orders. Call once ready. */
export function withIndexValues(dir: GalleryDir, entries: GalleryEntry[]): (GalleryEntry & { created: number; pixels: number })[] {
  const index = indexFor(dir)
  return entries.map((entry) => {
    const record = index.records.get(entry.name)
    return { ...entry, created: record?.created ?? entry.mtime, pixels: record?.pixels ?? 0 }
  })
}

/** The models named across the folder, sorted. Call once ready. */
export function modelsOf(dir: GalleryDir, entries: GalleryEntry[]): string[] {
  const index = indexFor(dir)
  const models = new Set<string>()
  for (const entry of entries) {
    const model = index.records.get(entry.name)?.model
    if (model) models.add(model)
  }
  return [...models].sort((a, b) => a.localeCompare(b))
}
