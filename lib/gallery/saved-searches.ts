// Searches the user saved by name: the search box, the order and the
// filters, to apply again to whichever folder is open.
//
// Kept in this browser only (localStorage, see hooks/use-saved-searches.ts),
// never on the server: what was searched for can say what the pictures are,
// and a phone's list stays on the phone. No folder is stored, so a saved
// search names no folder on this computer. Nothing is saved unless the user
// saves it, and in secret mode nothing is saved or shown.
//
// Pure, so the verify script can pin it down. A stored list from an older or
// a broken page is read through fromParams, the same check the API applies,
// so an unknown value is dropped rather than trusted.

import { fromParams, toParams, type GalleryQuery } from './filter'

export const SAVED_SEARCHES_KEY = 'latentry:gallery-searches'
export const SAVED_SEARCHES_VERSION = 1
export const MAX_SAVED = 50
export const MAX_NAME = 60

export interface SavedSearch {
  id: string
  name: string
  /** The query as URL parameters (toParams), without an opened stack. */
  params: string
}

export type SaveResult = { searches: SavedSearch[]; id: string } | { error: 'name' | 'full' | 'empty' }

/**
 * What of a query is saved: all of it but the opened stack, which is one
 * stack of one folder, not a search.
 */
export function savedParams(query: GalleryQuery): string {
  return toParams({ ...query, stack: undefined }).toString()
}

/** The saved query, checked as the API checks it. */
export function savedQuery(search: SavedSearch): GalleryQuery {
  return fromParams(new URLSearchParams(search.params))
}

/** Whether a query has anything worth saving: a search, an order or a filter. */
export function canSave(query: GalleryQuery): boolean {
  return savedParams(query) !== ''
}

export function cleanName(name: string): string {
  // Control characters out, runs of spaces as one, at most MAX_NAME characters.
  const flat = name.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return Array.from(flat).slice(0, MAX_NAME).join('').trim()
}

const sameName = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase()

/** The list read back from storage: anything that is not a saved search is left out. */
export function parseSaved(raw: string | null): SavedSearch[] {
  if (!raw) return []
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  if (!data || typeof data !== 'object') return []
  const { version, searches } = data as { version?: unknown; searches?: unknown }
  if (version !== SAVED_SEARCHES_VERSION || !Array.isArray(searches)) return []
  const list: SavedSearch[] = []
  for (const item of searches) {
    if (list.length >= MAX_SAVED) break
    if (!item || typeof item !== 'object') continue
    const { id, name, params } = item as Record<string, unknown>
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(id) || list.some((other) => other.id === id)) continue
    if (typeof name !== 'string' || typeof params !== 'string') continue
    const clean = cleanName(name)
    if (!clean || list.some((other) => sameName(other.name, clean))) continue
    // Re-written through the checks, so only known values stay.
    const checked = savedParams(fromParams(new URLSearchParams(params)))
    if (!checked) continue
    list.push({ id, name: clean, params: checked })
  }
  return list
}

/** The list as it is stored; an empty list is not stored at all. */
export function serializeSaved(searches: SavedSearch[]): string | null {
  if (searches.length === 0) return null
  return JSON.stringify({ version: SAVED_SEARCHES_VERSION, searches })
}

/**
 * Saves the query under a name. A name already in the list (in any case) is
 * that search, saved again with this query; a new one goes to the end.
 */
export function saveSearch(searches: SavedSearch[], name: string, query: GalleryQuery, newId: () => string): SaveResult {
  const clean = cleanName(name)
  if (!clean) return { error: 'name' }
  const params = savedParams(query)
  if (!params) return { error: 'empty' }
  const existing = searches.find((search) => sameName(search.name, clean))
  if (existing) {
    return { id: existing.id, searches: searches.map((search) => (search === existing ? { ...search, name: clean, params } : search)) }
  }
  if (searches.length >= MAX_SAVED) return { error: 'full' }
  const id = newId()
  return { id, searches: [...searches, { id, name: clean, params }] }
}

/** Renames one search; a name another search has is refused. */
export function renameSearch(searches: SavedSearch[], id: string, name: string): SavedSearch[] | null {
  const clean = cleanName(name)
  if (!clean || searches.some((search) => search.id !== id && sameName(search.name, clean))) return null
  return searches.map((search) => (search.id === id ? { ...search, name: clean } : search))
}

export function removeSearch(searches: SavedSearch[], id: string): SavedSearch[] {
  return searches.filter((search) => search.id !== id)
}

/** The saved search that is exactly the current query, if any. */
export function currentSearch(searches: SavedSearch[], query: GalleryQuery): SavedSearch | null {
  const params = savedParams(query)
  if (!params) return null
  return searches.find((search) => search.params === params) ?? null
}

/** A name to offer when saving: the search box's words, else nothing. */
export function suggestedName(query: GalleryQuery): string {
  return cleanName(query.q ?? '')
}
