"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { ImageMeta } from "@/lib/gallery/png-meta"

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
}

export interface GalleryFilter {
  q?: string
  backend?: string
  profile?: string
}

export function pictureUrl(picture: { dir: number; name: string }, thumb = false): string {
  const base = `/api/gallery/${picture.dir}/${encodeURIComponent(picture.name)}`
  return thumb ? `${base}?thumb=1` : base
}

/** The gallery's folders; null until known. */
export function useGalleryFolders(): GalleryFolder[] | null {
  const [folders, setFolders] = useState<GalleryFolder[] | null>(null)
  useEffect(() => {
    let active = true
    fetch("/api/gallery", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { dirs: [] }))
      .then((data) => {
        if (active) setFolders(Array.isArray(data?.dirs) ? data.dirs : [])
      })
      .catch(() => {
        if (active) setFolders([])
      })
    return () => {
      active = false
    }
  }, [])
  return folders
}

const PAGE_SIZE = 60

export interface GalleryPage {
  pictures: GalleryPicture[]
  loading: boolean
  error: string | null
  hasMore: boolean
  loadMore: () => Promise<void>
  reload: () => void
  /** Replaces one picture's metadata in place, after its tags were written. */
  patch: (picture: GalleryPicture, meta: ImageMeta) => void
}

/**
 * One folder of the gallery, a page at a time. Changing the folder or the
 * filter starts over; `loadMore` is safe to call repeatedly (it ignores calls
 * while a page is on its way).
 */
export function useGalleryPage(dir: number | null, filter: GalleryFilter): GalleryPage {
  const [pictures, setPictures] = useState<GalleryPicture[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [generation, setGeneration] = useState(0)
  const inFlight = useRef(false)
  // Which folder + filter the current list belongs to, so a slow page for the
  // previous one cannot land in the new one.
  const keyRef = useRef("")
  const key = `${dir}|${filter.q ?? ""}|${filter.backend ?? ""}|${filter.profile ?? ""}|${generation}`

  const fetchPage = useCallback(
    async (from: string | null, forKey: string) => {
      if (dir === null) return
      inFlight.current = true
      setLoading(true)
      try {
        const params = new URLSearchParams({ dir: String(dir), limit: String(PAGE_SIZE) })
        if (from) params.set("cursor", from)
        if (filter.q) params.set("q", filter.q)
        if (filter.backend) params.set("backend", filter.backend)
        if (filter.profile) params.set("profile", filter.profile)
        const response = await fetch(`/api/gallery?${params}`, { cache: "no-store" })
        const data = await response.json().catch(() => null)
        if (keyRef.current !== forKey) return
        if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : String(response.status))
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
    [dir, filter.q, filter.backend, filter.profile]
  )

  /* eslint-disable react-hooks/set-state-in-effect -- a new folder or filter is a new
     query against the server; clearing the old list is part of starting it. */
  useEffect(() => {
    keyRef.current = key
    setPictures([])
    setCursor(null)
    setHasMore(false)
    void fetchPage(null, key)
  }, [key, fetchPage])
  /* eslint-enable react-hooks/set-state-in-effect */

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

  return { pictures, loading, error, hasMore, loadMore, reload, patch }
}

/** Fetches a gallery picture as a Blob, for the slots that take a source image. */
export async function fetchPicture(url: string): Promise<Blob> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(String(response.status))
  return response.blob()
}
