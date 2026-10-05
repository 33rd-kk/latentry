"use client"

import { useCallback, useEffect, useState } from "react"
import type { ProfileId } from "@/lib/profiles"

const POLL_MS = 20 * 1000
const LOADING_POLL_MS = 2 * 1000

export interface EngineModelOption {
  id: string
  name: string
  family: string
  /** The profile a model like this starts the form with. */
  profile: ProfileId
}

interface EngineModelsResponse {
  editable: boolean
  engines?: string[]
  models?: EngineModelOption[] | null
  current?: string | null
  loading?: string | null
  loadError?: string | null
}

export interface EngineModelsState {
  /** The ids of Latentry's own engines; a model can only be chosen for them. */
  engines: string[]
  /** What is in the models folder, or null while it is not known. */
  models: EngineModelOption[] | null
  current: string | null
  /** The model being loaded, from the moment it was asked for. */
  loading: string | null
  loadError: string | null
  /** Asks the engines to load a model; resolves to an error message, or null. */
  load: (id: string) => Promise<string | null>
}

/**
 * The models Latentry's engines can load right now — the ones in the models
 * folder, not the ones the Setup page offers to download — and the one they
 * have loaded. Empty for a client that may not change the engine.
 */
export function useEngineModels(): EngineModelsState {
  const [data, setData] = useState<EngineModelsResponse>({ editable: false })
  // Asked for here and not yet loaded: the engine's own report lags a moment.
  const [requested, setRequested] = useState<string | null>(null)

  const refresh = useCallback(() => {
    fetch("/api/engine/models", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((next: EngineModelsResponse | null) => {
        if (!next) return
        setData(next)
        if (next.current && next.current === requested && !next.loading) setRequested(null)
        if (next.loadError && !next.loading) setRequested(null)
      })
      .catch(() => {
        // Offline; the next poll tries again.
      })
  }, [requested])

  const busy = Boolean(requested || data.loading)

  useEffect(() => {
    refresh()
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh()
    }, busy ? LOADING_POLL_MS : POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [refresh, busy])

  const load = useCallback(
    async (id: string) => {
      setRequested(id)
      const response = await fetch("/api/engine/models/load", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      }).catch(() => null)
      if (response?.ok) return null
      setRequested(null)
      const payload = await response?.json().catch(() => null)
      return String(payload?.error ?? (response ? `HTTP ${response.status}` : "unreachable"))
    },
    []
  )

  return {
    engines: data.editable ? (data.engines ?? []) : [],
    models: data.editable ? (data.models ?? null) : null,
    current: data.current ?? null,
    loading: data.loading ?? requested,
    loadError: requested ? null : (data.loadError ?? null),
    load,
  }
}
