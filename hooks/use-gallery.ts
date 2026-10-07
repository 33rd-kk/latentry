"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { ImageMeta } from "@/lib/image-meta"
import { toParams, type GalleryQuery } from "@/lib/gallery/filter"
import type { IndexProgress } from "@/lib/gallery/fs"
import type { Facets } from "@/lib/gallery/folder-index"

export interface GalleryFolder {
  index: number
  label: string
  writable: boolean
}

export interface GalleryPicture {
  dir: number
  name: string
  mtime: number
  size: number
  width: number | null
  height: number | null
  meta: ImageMeta | null
  /** When stacking: the stack this picture stands for (see lib/gallery/fs.ts). */
  stack?: { key: string; count: number }
}

export function pictureUrl(picture: { dir: number; name: string }, thumb = false): string {
  const base = `/api/gallery/${picture.dir}/${encodeURIComponent(picture.name)}`
  return thumb ? `${base}?thumb=1` : base
}

/**
 * The gallery's folders, null until known, and whether pictures can be shown
 * in the file manager from this browser (only on the machine itself).
 */
export function useGalleryFolders(): { folders: GalleryFolder[] | null; canOpen: boolean } {
  const [state, setState] = useState<{ folders: GalleryFolder[] | null; canOpen: boolean }>({ folders: null, canOpen: false })
  useEffect(() => {
    let active = true
    fetch("/api/gallery", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { dirs: [] }))
      .then((data) => {
        if (active) setState({ folders: Array.isArray(data?.dirs) ? data.dirs : [], canOpen: data?.canOpen === true })
      })
      .catch(() => {
        if (active) setState({ folders: [], canOpen: false })
      })
    return () => {
      active = false
    }
  }, [])
  return state
}

const PAGE_SIZE = 60
// How soon to ask again while the server reads a folder for a meta order.
const INDEX_POLL_MS = 500

function isIndexProgress(value: unknown): value is IndexProgress {
  return typeof value === "object" && value !== null && typeof (value as { total?: unknown }).total === "number"
}

export interface GalleryPage {
  pictures: GalleryPicture[]
  loading: boolean
  error: string | null
  hasMore: boolean
  /** While the server reads the whole folder for this order: how far it has got. */
  indexing: IndexProgress | null
  loadMore: () => Promise<void>
  reload: () => void
  /** Replaces one picture's metadata in place, after its tags were written. */
  patch: (picture: GalleryPicture, meta: ImageMeta) => void
}

/**
 * One folder of the gallery, a page at a time. Changing the folder, the order
 * or a filter starts over; `loadMore` is safe to call repeatedly (it ignores calls
 * while a page is on its way).
 */
export function useGalleryPage(dir: number | null, query: GalleryQuery): GalleryPage {
  const [pictures, setPictures] = useState<GalleryPicture[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [generation, setGeneration] = useState(0)
  const [indexing, setIndexing] = useState<IndexProgress | null>(null)
  // Bumped to ask for the first page again while the folder is being read.
  const [poll, setPoll] = useState(0)
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlight = useRef(false)
  // The query as it is sent; equal queries give equal strings.
  const queryString = toParams(query).toString()
  // Which folder + query the current list belongs to, so a slow page for the
  // previous one cannot land in the new one.
  const keyRef = useRef("")
  const key = `${dir}|${queryString}|${generation}|${poll}`

  const fetchPage = useCallback(
    async (from: string | null, forKey: string) => {
      if (dir === null) return
      inFlight.current = true
      setLoading(true)
      try {
        const params = new URLSearchParams(queryString)
        params.set("dir", String(dir))
        params.set("limit", String(PAGE_SIZE))
        if (from) params.set("cursor", from)
        const response = await fetch(`/api/gallery?${params}`, { cache: "no-store" })
        const data = await response.json().catch(() => null)
        if (keyRef.current !== forKey) return
        if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : String(response.status))
        const progress = isIndexProgress(data?.indexing) ? data.indexing : null
        setIndexing(progress)
        if (progress && !("tooLarge" in progress)) pollTimer.current = setTimeout(() => setPoll((value) => value + 1), INDEX_POLL_MS)
        const items: GalleryPicture[] = Array.isArray(data?.items) ? data.items : []
        setPictures((previous) => (from ? [...previous, ...items] : items))
        setCursor(typeof data?.nextCursor === "string" ? data.nextCursor : null)
        setHasMore(typeof data?.nextCursor === "string")
        setError(null)
      } catch (caught) {
        if (keyRef.current === forKey) setError(caught instanceof Error ? caught.message : String(caught))
      } finally {
        if (keyRef.current === forKey) setLoading(false)
        inFlight.current = false
      }
    },
    [dir, queryString]
  )

  /* eslint-disable react-hooks/set-state-in-effect -- a new folder or filter is a new
     query against the server; clearing the old list is part of starting it. */
  useEffect(() => {
    keyRef.current = key
    if (pollTimer.current) clearTimeout(pollTimer.current)
    setPictures([])
    setCursor(null)
    setHasMore(false)
    void fetchPage(null, key)
  }, [key, fetchPage])
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => () => {
    if (pollTimer.current) clearTimeout(pollTimer.current)
  }, [])

  const loadMore = useCallback(async () => {
    if (inFlight.current || !cursor) return
    await fetchPage(cursor, keyRef.current)
  }, [cursor, fetchPage])

  const reload = useCallback(() => setGeneration((value) => value + 1), [])

  const patch = useCallback((picture: GalleryPicture, meta: ImageMeta) => {
    setPictures((previous) =>
      previous.map((item) => (item.dir === picture.dir && item.name === picture.name ? { ...item, meta } : item))
    )
  }, [])

  return { pictures, loading, error, hasMore, indexing, loadMore, reload, patch }
}

function names(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((name): name is string => typeof name === "string") : []
}

/**
 * Every model and LoRA named in a folder, for the filters: null until the
 * server has read the folder, with `progress` meanwhile. Asks only while
 * `enabled` (the filter panel is open, and never in secret mode).
 */
export function useFolderFacets(dir: number | null, enabled: boolean): { facets: Facets | null; progress: IndexProgress | null } {
  const [state, setState] = useState<{ for: string; facets: Facets | null; progress: IndexProgress | null }>({ for: "", facets: null, progress: null })
  const key = `${dir}`
  useEffect(() => {
    if (!enabled || dir === null) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const ask = async () => {
      try {
        const response = await fetch(`/api/gallery?dir=${dir}&facets=1`, { cache: "no-store" })
        const data = await response.json().catch(() => null)
        if (!active || !response.ok) return
        const progress = isIndexProgress(data?.indexing) ? data.indexing : null
        const facets = data?.facets ? { models: names(data.facets.models), loras: names(data.facets.loras) } : null
        setState({ for: key, facets, progress })
        if (progress && !("tooLarge" in progress)) timer = setTimeout(() => void ask(), INDEX_POLL_MS)
      } catch {
        // The names seen so far stay in use.
      }
    }
    void ask()
    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [dir, enabled, key])
  return state.for === key ? { facets: state.facets, progress: state.progress } : { facets: null, progress: null }
}

/** Fetches a gallery picture as a Blob, for the slots that take a source image. */
export async function fetchPicture(url: string): Promise<Blob> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(String(response.status))
  return response.blob()
}
