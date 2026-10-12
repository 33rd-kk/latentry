"use client"

import { useCallback, useState } from "react"
import type { BackendStatus } from "@/lib/backends/types"
import type { BackendDraft } from "@/lib/settings/draft"

export interface BackendTest {
  state: "testing" | "ok" | "fail"
  model?: string | null
  hints?: BackendStatus["hints"]
  /** comfyui: the checkpoints it has, offered for the Model field. */
  checkpoints?: string[]
  /** comfyui: the ControlNets it has, offered for the Pose ControlNet field. */
  controlnets?: string[]
  problem?: BackendStatus["problem"]
}

/** The settings page's "Test" button: each backend row's last answer, by its key. */
export function useBackendTests() {
  const [tests, setTests] = useState<Record<string, BackendTest>>({})

  const testBackend = useCallback(async (backend: BackendDraft) => {
    setTests((current) => ({ ...current, [backend.key]: { state: "testing" } }))
    try {
      const response = await fetch("/api/settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: backend.id,
          kind: backend.kind,
          url: backend.url,
          token: backend.token || undefined,
          profile: backend.profile,
          model: backend.kind === "comfyui" ? backend.model.trim() || undefined : undefined,
          controlnet: backend.kind === "comfyui" ? backend.controlnet.trim() || undefined : undefined,
        }),
      })
      const data = await response.json().catch(() => null)
      const names = (value: unknown) => (Array.isArray(value) ? (value as unknown[]).filter((name): name is string => typeof name === "string") : undefined)
      const checkpoints = names(data?.checkpoints)
      const controlnets = names(data?.controlnets)
      setTests((current) => ({
        ...current,
        [backend.key]: { state: data?.alive ? "ok" : "fail", model: data?.model, hints: data?.hints, checkpoints, controlnets, problem: data?.problem },
      }))
    } catch {
      setTests((current) => ({ ...current, [backend.key]: { state: "fail" } }))
    }
  }, [])

  return { tests, testBackend }
}
