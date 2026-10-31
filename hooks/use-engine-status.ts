"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import type { CatalogView, EngineStatus } from "@/lib/engine/status"
import { useT } from "@/lib/i18n"

/** What /api/engine answers when this page may not change the engine. */
export type Refused = { editable: false; reason: "off" | "notLocal" }

const POLL_BUSY_MS = 1500
const POLL_IDLE_MS = 5000

export async function post(path: string, body: unknown = {}): Promise<{ ok: boolean; error?: string }> {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  if (response.ok) return { ok: true }
  const payload = await response.json().catch(() => null)
  return { ok: false, error: payload?.error ?? `HTTP ${response.status}` }
}

/**
 * The engine's status for the Setup page, polled (faster while something is
 * installing, starting, loading or downloading), and the page's actions.
 */
export function useEngineStatus() {
  const t = useT()
  const [status, setStatus] = useState<EngineStatus | Refused | null>(null)
  const [pending, setPending] = useState<string | null>(null)

  const refresh = useCallback(() => {
    fetch("/api/engine", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data) setStatus(data)
      })
      .catch(() => {
        // Restarting; the next poll tries again.
      })
  }, [])

  const engineStatus = status && status.editable ? status : null
  const busy = Boolean(
    engineStatus &&
      (engineStatus.install.state === "running" ||
        engineStatus.engines.some((engine) => engine.state === "starting" || engine.loading) ||
        [...engineStatus.catalog.map((entry) => entry.download), ...(engineStatus.urlDownloads ?? [])].some((download) =>
          ["queued", "downloading", "verifying"].includes(download?.state ?? "")
        ))
  )

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, busy ? POLL_BUSY_MS : POLL_IDLE_MS)
    return () => clearInterval(timer)
  }, [refresh, busy])

  const act = useCallback(
    async (key: string, path: string, body?: unknown) => {
      setPending(key)
      const result = await post(path, body)
      setPending(null)
      if (!result.ok) toast.error(t("setup.failed", { error: result.error ?? "" }))
      refresh()
    },
    [refresh, t]
  )

  const saveEngineSetting = useCallback(
    async (engine: Record<string, unknown>) => {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engine }),
      })
      if (!response.ok) toast.error(t("setup.failed", { error: `HTTP ${response.status}` }))
      refresh()
    },
    [refresh, t]
  )

  const chooseTagger = useCallback(
    async (entry: CatalogView) => {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wd14: { modelDir: entry.dir } }),
      })
      if (!response.ok) toast.error(t("setup.failed", { error: `HTTP ${response.status}` }))
      refresh()
    },
    [refresh, t]
  )

  return { status, pending, refresh, act, saveEngineSetting, chooseTagger }
}

/** The page's actions, for the cards. */
export type EngineActions = Pick<ReturnType<typeof useEngineStatus>, "pending" | "refresh" | "act" | "saveEngineSetting" | "chooseTagger">
