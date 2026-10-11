"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { setProfileOverrides } from "@/lib/profiles"
import { toDraft, toInput, type ChangeDraft, type Draft, type Part } from "@/lib/settings/draft"
import type { SettingsView } from "@/lib/settings/view"
import { useT } from "@/lib/i18n"

export type LoadedView = SettingsView | { editable: false; reason: "off" | "notLocal" }

export interface SettingsForm {
  /** null until the server answers. */
  view: LoadedView | null
  draft: Draft | null
  dirty: Set<Part>
  /** The server's complaints, by field path, as message keys. */
  errors: Record<string, string>
  saving: boolean
  backendIds: string[]
  /** Reads the settings again, dropping unsaved changes. */
  load: () => Promise<void>
  change: ChangeDraft
  /** Saves the changed parts, or `override` as it is (e.g. `{ backends: null }`). */
  save: (override?: Record<string, unknown>) => Promise<void>
}

/** The settings page's state: what the server has, the draft being edited, and saving it. */
export function useSettingsForm(): SettingsForm {
  const t = useT()
  const [view, setView] = useState<LoadedView | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [dirty, setDirty] = useState<Set<Part>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const response = await fetch("/api/settings", { cache: "no-store" })
    const data = await response.json()
    setView(data)
    if (data.editable) {
      setDraft(toDraft(data))
      setDirty(new Set())
      setErrors({})
    }
  }, [])

  /* eslint-disable react-hooks/set-state-in-effect -- the settings live on the server;
     fetching them on mount is the synchronisation, and every setState happens after the
     response arrives. */
  useEffect(() => {
    void load()
  }, [load])
  /* eslint-enable react-hooks/set-state-in-effect */

  const change = useCallback<ChangeDraft>((part, update) => {
    setDraft((current) => (current ? update(current) : current))
    setDirty((current) => new Set(current).add(part))
  }, [])

  const backendIds = useMemo(() => (draft?.backends ?? []).map((backend) => backend.id).filter(Boolean), [draft])

  const save = useCallback(
    async (override?: Record<string, unknown>) => {
      if (!draft) return
      setSaving(true)
      try {
        const response = await fetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(override ?? toInput(draft, dirty)),
        })
        const data = await response.json().catch(() => null)
        if (response.status === 422 && data?.errors) {
          setErrors(data.errors)
          toast.error(t("settings.invalid"))
          return
        }
        if (!response.ok) throw new Error(data?.error ?? String(response.status))
        setView(data)
        setDraft(toDraft(data))
        setDirty(new Set())
        setErrors({})
        // So the generate page, open in another tab, picks the new defaults up
        // on its next poll; this tab already has them.
        setProfileOverrides(data.profiles)
        toast(t("settings.saved"))
      } catch (error) {
        toast.error(t("settings.saveFailed"), { description: error instanceof Error ? error.message : undefined })
      } finally {
        setSaving(false)
      }
    },
    [draft, dirty, t]
  )

  return { view, draft, dirty, errors, saving, backendIds, load, change, save }
}
