"use client"

import { useCallback, useEffect, useState } from "react"
import type { ModelInfo } from "@/lib/models/info"

/** What is sent to keep a model's info: everything but its name and time. */
export type ModelInfoDraft = Omit<ModelInfo, "name" | "updatedAt">

export interface ModelInfoState {
  /** False for a client that may not see model info (a paired device), or while it is not known. */
  available: boolean
  info: ModelInfo | null
  /** Keeps the info; resolves to null, or the server's error with its field errors. */
  save: (draft: ModelInfoDraft) => Promise<{ error: string; errors?: Record<string, string> } | null>
  remove: () => Promise<string | null>
}

/**
 * The info kept for one model (by its file name): its link and recommended
 * settings. Read from the server, never stored in the browser. Only this
 * computer and owner devices get it; for anyone else the route says no and
 * `available` stays false.
 */
export function useModelInfo(name: string | null): ModelInfoState {
  const [state, setState] = useState<{ name: string | null; available: boolean; info: ModelInfo | null }>({ name: null, available: false, info: null })

  useEffect(() => {
    if (!name) return
    let live = true
    fetch(`/api/models/info?name=${encodeURIComponent(name)}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { info?: ModelInfo | null } | null) => {
        if (live) setState({ name, available: Boolean(body), info: body?.info ?? null })
      })
      .catch(() => {
        if (live) setState({ name, available: false, info: null })
      })
    return () => {
      live = false
    }
  }, [name])

  const save = useCallback(
    async (draft: ModelInfoDraft) => {
      if (!name) return { error: "No model" }
      const response = await fetch("/api/models/info", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, info: draft }),
      }).catch(() => null)
      const body = await response?.json().catch(() => null)
      if (response?.ok) {
        setState({ name, available: true, info: body?.info ?? null })
        return null
      }
      return { error: String(body?.error ?? (response ? `HTTP ${response.status}` : "unreachable")), errors: body?.errors }
    },
    [name]
  )

  const remove = useCallback(async () => {
    if (!name) return null
    const response = await fetch(`/api/models/info?name=${encodeURIComponent(name)}`, { method: "DELETE" }).catch(() => null)
    if (response?.ok) {
      setState({ name, available: true, info: null })
      return null
    }
    const body = await response?.json().catch(() => null)
    return String(body?.error ?? (response ? `HTTP ${response.status}` : "unreachable"))
  }, [name])

  // What was read for another model is not this one's.
  const current = state.name === name && name !== null
  return { available: current && state.available, info: current ? state.info : null, save, remove }
}
