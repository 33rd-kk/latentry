"use client"

import { useCallback, useEffect, useState } from "react"

interface WildcardsResponse {
  available: boolean
  shared?: boolean
  names?: string[]
}

export interface WildcardsState {
  /** Whether this client may use the wildcards folder (one is set, and it may). */
  available: boolean
  /** The wildcards' names; null until asked for. */
  names: string[] | null
  /** Reads the list again: when the picker opens, so a new file shows. */
  refresh: () => void
}

/**
 * The wildcards folder, for the picker. Only whether this client gets one is
 * asked on page load; the names are asked for when the picker opens, not
 * before: they are the user's own files.
 */
export function useWildcards(): WildcardsState {
  const [available, setAvailable] = useState(false)
  const [names, setNames] = useState<string[] | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch("/api/wildcards?probe=1", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((next: WildcardsResponse | null) => {
        if (!cancelled && next) setAvailable(next.available)
      })
      .catch(() => {
        // Offline: no picker.
      })
    return () => {
      cancelled = true
    }
  }, [])
  const refresh = useCallback(() => {
    fetch("/api/wildcards", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((next: WildcardsResponse | null) => {
        if (next) setNames(next.available ? (next.names ?? []) : null)
      })
      .catch(() => {
        // Offline; opening the picker again tries again.
      })
  }, [])
  return { available, names, refresh }
}
