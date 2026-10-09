"use client"

import { useCallback, useState } from "react"

export interface EngineLora {
  name: string
  /** The model family it was made for; null when the engine could not tell. */
  family: string | null
  license: string | null
}

interface EngineLorasResponse {
  editable: boolean
  loras?: EngineLora[] | null
}

export interface EngineLorasState {
  /** What is in the loras folder; null until asked for, or when it could not be read. */
  loras: EngineLora[] | null
  /** Reads the list again: when the picker opens, so a new file shows. */
  refresh: () => void
}

/**
 * The LoRAs Latentry's engine can apply. Asked for only when the picker
 * opens, not on every page load: the names are the user's own files.
 */
export function useEngineLoras(): EngineLorasState {
  const [loras, setLoras] = useState<EngineLora[] | null>(null)
  const refresh = useCallback(() => {
    fetch("/api/engine/loras", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((next: EngineLorasResponse | null) => {
        if (next) setLoras(next.editable ? (next.loras ?? null) : null)
      })
      .catch(() => {
        // Offline; opening the picker again tries again.
      })
  }, [])
  return { loras, refresh }
}
