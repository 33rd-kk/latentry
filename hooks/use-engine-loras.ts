"use client"

import { useCallback, useEffect, useState } from "react"

export interface EngineLora {
  name: string
  /** The model family it was made for; null when the engine could not tell. */
  family: string | null
  license: string | null
}

interface EngineLorasResponse {
  editable: boolean
  shared?: boolean
  engines?: string[]
  loras?: EngineLora[] | null
}

export interface EngineLorasState {
  /** What is in the loras folder; null until asked for, or when it could not be read. */
  loras: EngineLora[] | null
  /**
   * The backends (Latentry's engines) this client may pick LoRAs for: every
   * engine for a client that may change settings, or for a paired device
   * when sharing is on; none otherwise.
   */
  engines: string[]
  /** Reads the list again: when the picker opens, so a new file shows. */
  refresh: () => void
}

/**
 * The LoRAs Latentry's engine can apply. Only whether this client gets a
 * picker is asked on page load; the names are asked for when the picker
 * opens, not before: they are the user's own files.
 */
export function useEngineLoras(): EngineLorasState {
  const [loras, setLoras] = useState<EngineLora[] | null>(null)
  const [engines, setEngines] = useState<string[]>([])
  useEffect(() => {
    let cancelled = false
    fetch("/api/engine/loras?probe=1", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((next: EngineLorasResponse | null) => {
        if (!cancelled && next && (next.editable || next.shared)) setEngines(next.engines ?? [])
      })
      .catch(() => {
        // Offline: no picker, as before.
      })
    return () => {
      cancelled = true
    }
  }, [])
  const refresh = useCallback(() => {
    fetch("/api/engine/loras", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((next: EngineLorasResponse | null) => {
        if (next) setLoras(next.editable || next.shared ? (next.loras ?? null) : null)
      })
      .catch(() => {
        // Offline; opening the picker again tries again.
      })
  }, [])
  return { loras, engines, refresh }
}
