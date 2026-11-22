"use client"

import { useCallback, useSyncExternalStore } from "react"
import { isSecretMode } from "@/lib/secret-mode"
import {
  parseSaved,
  removeSearch,
  renameSearch,
  SAVED_SEARCHES_KEY,
  saveSearch,
  serializeSaved,
  type SaveResult,
  type SavedSearch,
} from "@/lib/gallery/saved-searches"
import type { GalleryQuery } from "@/lib/gallery/filter"

// The saved searches of this browser (lib/gallery/saved-searches.ts), shared
// live by every tab. In secret mode the list reads as empty and nothing is
// written; what was saved before stays where it is, unshown.

const CHANGE_EVENT = "latentry-saved-searches"
const EMPTY: SavedSearch[] = []

// The parsed list of the stored text, so an unchanged store gives the same array.
let cache: { raw: string | null; searches: SavedSearch[] } = { raw: null, searches: EMPTY }

function readRaw(): string | null {
  try {
    return localStorage.getItem(SAVED_SEARCHES_KEY)
  } catch {
    return null
  }
}

function snapshot(secret: boolean): SavedSearch[] {
  if (secret) return EMPTY
  const raw = readRaw()
  if (raw !== cache.raw) cache = { raw, searches: raw === null ? EMPTY : parseSaved(raw) }
  return cache.searches
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === SAVED_SEARCHES_KEY || event.key === null) listener()
  }
  window.addEventListener(CHANGE_EVENT, listener)
  window.addEventListener("storage", onStorage)
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener)
    window.removeEventListener("storage", onStorage)
  }
}

/** False when the browser refused to keep it (storage full or blocked) or secret mode is on. */
function store(searches: SavedSearch[]): boolean {
  if (isSecretMode()) return false
  try {
    const text = serializeSaved(searches)
    if (text === null) localStorage.removeItem(SAVED_SEARCHES_KEY)
    else localStorage.setItem(SAVED_SEARCHES_KEY, text)
  } catch {
    return false
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
  return true
}

// Not crypto.randomUUID: a phone on the LAN over plain http has no secure
// context, and getRandomValues works without one.
function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

export interface SavedSearches {
  searches: SavedSearch[]
  /** Saves the query under the name; `error: 'storage'` when the browser would not keep it. */
  save: (name: string, query: GalleryQuery) => SaveResult | { error: "storage" }
  rename: (id: string, name: string) => boolean
  remove: (id: string) => void
  removeAll: () => void
}

/** `secret`: secret mode, read by the page so the list follows it at once. */
export function useSavedSearches(secret: boolean): SavedSearches {
  const searches = useSyncExternalStore(
    subscribe,
    () => snapshot(secret),
    () => EMPTY
  )
  const save = useCallback((name: string, query: GalleryQuery) => {
    const result = saveSearch(snapshot(false), name, query, newId)
    if ("error" in result) return result
    return store(result.searches) ? result : { error: "storage" as const }
  }, [])
  const rename = useCallback((id: string, name: string) => {
    const next = renameSearch(snapshot(false), id, name)
    return next !== null && store(next)
  }, [])
  const remove = useCallback((id: string) => void store(removeSearch(snapshot(false), id)), [])
  const removeAll = useCallback(() => void store([]), [])
  return { searches, save, rename, remove, removeAll }
}
