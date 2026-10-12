"use client"

import { useEffect, useState } from "react"
import type { BackendStatus } from "@/lib/backends/types"

/** One workflow as the server lists it (see lib/backends/comfy-workflows.ts). */
export interface WorkflowOption {
  name: string
  missing: ("negative" | "seed" | "size" | "steps" | "cfg" | "sampler")[]
  problem?: string
  /** It takes a skeleton in a `latentry:pose` LoadImage. */
  pose?: boolean
}

/**
 * The workflows a ComfyUI backend offers from its folder, for the selected
 * backend. Empty for other kinds, a backend without a folder, or a device that
 * may not see them; asked again when the backend changes or comes back up.
 */
export function useComfyWorkflows(status: BackendStatus | null): WorkflowOption[] {
  const [listed, setListed] = useState<{ owner: string; list: WorkflowOption[] } | null>(null)
  const id = status?.kind === "comfyui" && status.alive ? status.id : null

  useEffect(() => {
    if (!id) return
    let active = true
    fetch(`/api/gen/${encodeURIComponent(id)}/workflows`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!active) return
        const list = Array.isArray(data?.workflows) ? (data.workflows as WorkflowOption[]) : []
        setListed({ owner: id, list: list.filter((item) => typeof item?.name === "string") })
      })
      .catch(() => {
        if (active) setListed({ owner: id, list: [] })
      })
    return () => {
      active = false
    }
  }, [id])

  return id && listed?.owner === id ? listed.list : []
}
