// What the gallery knows about every picture in a folder at once: when it was
// made, its pixel count, and the model and LoRAs named in its settings.
// The orders by date made and by size, and the full list of models for the
// filter, need this for the whole folder before the first page.
//
// Built by reading each file's header (itemInfo, which caches), a slice at a
// time and in the background, so a request never waits on a large folder: it
// gets the progress instead and asks again. A picture is read once; a new or
// changed file is read on the next build, and only that file.
//
// Held in this process's memory only and never written anywhere. No prompts
// are kept, only the few fields above, a hash of the prompt to tell which
// pictures share one, and the seed.

import { createHash } from 'node:crypto'
import type { GalleryDir } from './dirs'
import { itemInfo, type GalleryEntry } from './fs'
import { normalizeText } from './query'
import type { StackGroup } from './filter'

/** Folders larger than this are not indexed; the meta orders say so instead. */
export const INDEX_MAX = 20000

interface IndexRecord {
  /** mtime:size of the file this was read from; another value means it changed. */
  key: string
  created: number
  pixels: number
  model?: string
  loras?: string[]
  /** SHA-1 of the normalised prompt; pictures with the same one share a prompt. */
  promptKey?: string
  seed?: number
}

/** The key a picture stacks under, or undefined when it has none (no prompt, no seed). */
export function stackKeyOf(dir: GalleryDir, name: string, group: StackGroup): string | undefined {
  const record = indexes.get(dir.path)?.records.get(name)
  if (!record) return undefined
  return group === 'prompt' ? record.promptKey : record.seed !== undefined ? String(record.seed) : undefined
}

function promptKeyOf(prompt: string | undefined): string | undefined {
  const text = normalizeText(prompt ?? '')
  return text ? createHash('sha1').update(text).digest('hex') : undefined
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
        loras: info.meta?.loras,
        promptKey: promptKeyOf(info.meta?.prompt),
        seed: info.meta?.seed,
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

/** The names a filter can offer for a folder. */
export interface Facets {
  models: string[]
  loras: string[]
}

/** The models and LoRAs named across the folder, each sorted. Call once ready. */
export function facetsOf(dir: GalleryDir, entries: GalleryEntry[]): Facets {
  const index = indexFor(dir)
  const models = new Set<string>()
  const loras = new Set<string>()
  for (const entry of entries) {
    const record = index.records.get(entry.name)
    if (record?.model) models.add(record.model)
    for (const lora of record?.loras ?? []) loras.add(lora)
  }
  const sorted = (names: Set<string>) => [...names].sort((a, b) => a.localeCompare(b))
  return { models: sorted(models), loras: sorted(loras) }
}
