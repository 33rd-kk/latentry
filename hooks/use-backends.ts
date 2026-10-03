"use client"

import { useCallback, useEffect, useState } from "react"
import type { BackendStatus } from "@/lib/backends/types"

const POLL_MS = 20 * 1000

export interface BackendsState {
  backends: BackendStatus[]
  /** The backend /api/gen/tag would use, or null when none can tag. */
  tagger: string | null
  loaded: boolean
  refresh: () => void
}

/**
 * The configured backends and their health, polled while the tab is visible
 * so a backend that comes up (or goes down) shows without a reload.
 */
export function useBackends(): BackendsState {
  const [backends, setBackends] = useState<BackendStatus[]>([])
  const [tagger, setTagger] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(() => {
    fetch("/api/gen/backends", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!data) return
        setBackends(Array.isArray(data.backends) ? data.backends : [])
        setTagger(typeof data.tagger === "string" ? data.tagger : null)
      })
      .catch(() => {
        // Offline; the next poll tries again.
      })
      .finally(() => setLoaded(true))
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh()
    }, POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [refresh])

  return { backends, tagger, loaded, refresh }
}
