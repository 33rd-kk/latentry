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
// It also answers the search box and the filters, so a search through a
// large folder does not open every file again: each picture's search text
// (file name, prompt, model, LoRAs and tags, normalised as ./query.ts does),
// its tags, the settings a `key:value` term names, and what the filters look
// at (./filter.ts MetaFacts). Those are the same values the file gives, so a
// search finds the same pictures from the index as from the files.
//
// Held in this process's memory only and never written anywhere, and gone
// when Latentry stops. About 1 KB a picture, most of it the search text.

import { createHash } from 'node:crypto'
import type { GalleryDir } from './dirs'
import { itemInfo, type GalleryEntry } from './fs'
import { matchesTerms, normalizeText, searchableOf, type Searchable, type SearchTarget, type SearchTerm } from './query'
import { matchesFacts, metaFactsOf, SOURCES, type GalleryQuery, type MetaFacts, type Source, type StackGroup } from './filter'

/** Folders larger than this are not indexed; the meta orders say so instead. */
export const INDEX_MAX = 500000

interface IndexRecord extends MetaFacts {
  /** mtime:size of the file this was read from; another value means it changed. */
  key: string
  created: number
  pixels: number
  /** SHA-1 of the normalised prompt; pictures with the same one share a prompt. */
  promptKey?: string
  seed?: number
  /** The X/Y grid it is a cell or the sheet of (its random id). */
  gridId?: string
  /**
   * The search text (./query.ts Searchable), a NUL, then every tag followed
   * by a NUL ("text\0tag\0tag\0"). One flat string: plain ASCII takes a
   * byte a character, and a Buffer would cost an object more per picture.
   */
  search: string
  /** Where the text ends (the first NUL). */
  textEnd: number
  // The rest of what a `key:value` term names; model, LoRAs and seed are above.
  sampler?: string
  steps?: number
  cfg?: number
  w?: number
  h?: number
}

function searchText(searchable: Searchable): { search: string; textEnd: number } {
  // A NUL in a prompt would read as the end of the text; none is typed into one.
  const text = searchable.text.replace(/\0/g, ' ')
  const search = `${text}\0${[...searchable.tags].map((tag) => `${tag.replace(/\0/g, ' ')}\0`).join('')}`
  // indexOf flattens the joined string here, so the parts are not kept.
  return { search, textEnd: search.indexOf('\0') }
}

/** The key a picture stacks under, or undefined when it has none (no prompt, no seed). */
export function stackKeyOf(dir: GalleryDir, name: string, group: StackGroup): string | undefined {
  const record = indexes.get(dir.path)?.records.get(name)
  if (!record) return undefined
  if (group === 'prompt') return record.promptKey
  if (group === 'grid') return record.gridId
  return record.seed !== undefined ? String(record.seed) : undefined
}

function promptKeyOf(prompt: string | undefined): string | undefined {
  const text = normalizeText(prompt ?? '')
  return text ? createHash('sha1').update(text).digest('hex') : undefined
}

interface FolderIndex {
  records: Map<string, IndexRecord>
  /** One copy of each model, LoRA, sampler and backend name, shared by every picture that names it. */
  names: Map<string, string>
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
  if (!index) indexes.set(dir.path, (index = { records: new Map(), names: new Map(), building: null, done: 0, total: 0 }))
  return index
}

function intern(index: FolderIndex, name: string | undefined): string | undefined {
  if (name === undefined) return undefined
  const known = index.names.get(name)
  if (known !== undefined) return known
  index.names.set(name, name)
  return name
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
      const searchable = searchableOf(info.name, info.meta, info)
      const facts = metaFactsOf(info)
      const { fields } = searchable
      index.records.set(info.name, {
        ...facts,
        backend: intern(index, facts.backend),
        profile: intern(index, facts.profile),
        model: intern(index, facts.model),
        loras: facts.loras?.map((lora) => intern(index, lora)!),
        ...searchText(searchable),
        sampler: intern(index, fields.sampler),
        steps: fields.steps,
        cfg: fields.cfg,
        w: fields.w,
        h: fields.h,
        key: keyOf(info),
        created: Number.isFinite(created) ? created : info.mtime,
        pixels: info.width && info.height ? info.width * info.height : 0,
        promptKey: promptKeyOf(info.meta?.prompt),
        seed: info.meta?.seed,
        ...(info.meta?.grid ? { gridId: info.meta.grid.id } : {}),
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

/**
 * A test of listed pictures against the filters and the search terms,
 * answered from the index, or null while the index does not cover the
 * listing (a build then starts, and the caller reads the files as before).
 */
export function indexMatcher(
  dir: GalleryDir,
  listing: GalleryEntry[],
  query: GalleryQuery,
  terms: SearchTerm[]
): ((entry: GalleryEntry) => boolean) | null {
  if (indexStatus(dir, listing).state !== 'ready') return null
  const index = indexFor(dir)
  const withFields = terms.some((term) => term.field)
  // Names repeat across pictures (they are shared, see intern), so each is normalised once.
  const normalised = new Map<string, string>()
  const normal = (name: string) => {
    let value = normalised.get(name)
    if (value === undefined) normalised.set(name, (value = normalizeText(name)))
    return value
  }
  return (entry) => {
    const record = index.records.get(entry.name)
    if (!record || !matchesFacts(record, query)) return false
    if (terms.length === 0) return true
    const loras = record.loras?.map(normal).filter(Boolean)
    const target: SearchTarget = {
      // The first place it occurs: if that is past the text, it is only in the tags.
      hasText: (text) => {
        const at = record.search.indexOf(text)
        return at !== -1 && at < record.textEnd
      },
      hasTag: (tag) => record.search.indexOf(`\0${tag}\0`, record.textEnd) !== -1,
      fields: withFields
        ? {
            model: record.model ? normal(record.model) : undefined,
            sampler: record.sampler,
            lora: loras?.length ? loras : undefined,
            seed: record.seed,
            steps: record.steps,
            cfg: record.cfg,
            w: record.w,
            h: record.h,
          }
        : {},
    }
    return matchesTerms(target, terms)
  }
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
  /** How many pictures hold each tool's settings: only from the whole folder's index, never from the pictures seen so far. */
  sources?: Partial<Record<Source, number>>
}

/** The models and LoRAs named across the folder, each sorted, and the pictures per source. Call once ready. */
export function facetsOf(dir: GalleryDir, entries: GalleryEntry[]): Facets {
  const index = indexFor(dir)
  const models = new Set<string>()
  const loras = new Set<string>()
  const sources: Partial<Record<Source, number>> = {}
  for (const entry of entries) {
    const record = index.records.get(entry.name)
    if (record?.model) models.add(record.model)
    for (const lora of record?.loras ?? []) loras.add(lora)
    if (record) sources[record.source] = (sources[record.source] ?? 0) + 1
  }
  const sorted = (names: Set<string>) => [...names].sort((a, b) => a.localeCompare(b))
  // In the filter's order, so the answer is the same however the folder was read.
  const ordered = Object.fromEntries(SOURCES.filter((source) => sources[source]).map((source) => [source, sources[source]]))
  return { models: sorted(models), loras: sorted(loras), sources: ordered }
}
