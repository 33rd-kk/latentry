"use client"

import { useCallback, useEffect, useState } from "react"
import { deleteModelInfo, getModelInfo, putModelInfo, type ModelInfoDraft, type ModelInfoFailure } from "@/lib/models/client"
import type { ModelInfo } from "@/lib/models/info"

export type { ModelInfoDraft } from "@/lib/models/client"

export interface ModelInfoState {
  /** False for a client that may not see model info (a paired device), or while it is not known. */
  available: boolean
  info: ModelInfo | null
  /** Keeps the info; resolves to null, or the server's error with its field errors. */
  save: (draft: ModelInfoDraft) => Promise<ModelInfoFailure | null>
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
    void getModelInfo(name).then((info) => {
      if (live) setState({ name, available: info !== undefined, info: info ?? null })
    })
    return () => {
      live = false
    }
  }, [name])

  const save = useCallback(
    async (draft: ModelInfoDraft) => {
      if (!name) return { error: "No model" }
      const result = await putModelInfo(name, draft)
      if (!("info" in result)) return result
      setState({ name, available: true, info: result.info })
      return null
    },
    [name]
  )

  const remove = useCallback(async () => {
    if (!name) return null
    const error = await deleteModelInfo(name)
    if (!error) setState({ name, available: true, info: null })
    return error
  }, [name])

  // What was read for another model is not this one's.
  const current = state.name === name && name !== null
  return { available: current && state.available, info: current ? state.info : null, save, remove }
}
