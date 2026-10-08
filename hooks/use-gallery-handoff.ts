"use client"

import { useCallback, useEffect, type MutableRefObject } from "react"
import { toast } from "sonner"
import { toSourceImage, type SourceImage, type SourceMode } from "@/components/generate/source-image-slot"
import { fetchPicture } from "@/hooks/use-gallery"
import { applySettings, type FormState } from "@/lib/generate/form"
import { formatForProfile, getProfile } from "@/lib/profiles"
import { drainHandoff, STORAGE_EVENT_NAME, STORAGE_KEYS, type HandoffItem } from "@/lib/storage"
import { appendTags } from "@/lib/tags"
import type { Translator } from "@/lib/i18n"

interface HandoffTargets {
  /** The selected backend's form is loaded, so there is somewhere to put things. */
  ready: boolean
  editForm: (change: (form: FormState) => FormState) => void
  /** The backend chosen here, to tell whether a picture's settings come from the same one. */
  backendRef: MutableRefObject<string | null>
  changeSource: (next: SourceImage | null) => void
  changeSourceMode: (mode: SourceMode) => void
  t: Translator
}

/**
 * What the gallery sent over (tags, a picture's settings, a picture as the
 * source), taken from the handoff queue into the form: once the form exists,
 * and again whenever the gallery adds more, in this tab or another.
 */
export function useGalleryHandoff({ ready, editForm, backendRef, changeSource, changeSourceMode, t }: HandoffTargets): void {
  const applyHandoff = useCallback(
    (items: HandoffItem[]) => {
      for (const item of items) {
        if (item.type === "tag" || item.type === "tags") {
          const tags = item.type === "tag" ? [item.tag] : item.tags
          editForm((form) => {
            const key = item.target === "positive" ? "prompt" : "negativePrompt"
            // In the spelling of the model they are going to.
            const spelled = tags.map((tag) => formatForProfile(tag, getProfile(form.profile)))
            return { ...form, [key]: appendTags(form[key], spelled) }
          })
        } else if (item.type === "settings") {
          // Into the backend chosen here, not the one the picture came from:
          // reusing a prompt on another backend is the point.
          const sameBackend = item.settings.backend === backendRef.current
          editForm((form) => applySettings(form, item.settings, sameBackend))
        } else if (item.type === "source") {
          fetchPicture(item.url)
            .then(toSourceImage)
            .then((picture) => {
              changeSource(picture)
              changeSourceMode(item.as)
            })
            .catch(() => toast.error(t("generate.sourceLoadFailed")))
        }
      }
    },
    [editForm, backendRef, changeSource, changeSourceMode, t]
  )

  // The queue lives in localStorage, written by the gallery (often in another
  // tab); draining it into the form once the form exists is the synchronisation
  // with an external store an effect is for.
  useEffect(() => {
    if (!ready) return
    applyHandoff(drainHandoff())
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEYS.HANDOFF && event.newValue) applyHandoff(drainHandoff())
    }
    const onSameTab = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (detail?.key === STORAGE_KEYS.HANDOFF && detail.value) applyHandoff(drainHandoff())
    }
    window.addEventListener("storage", onStorage)
    window.addEventListener(STORAGE_EVENT_NAME, onSameTab)
    return () => {
      window.removeEventListener("storage", onStorage)
      window.removeEventListener(STORAGE_EVENT_NAME, onSameTab)
    }
  }, [ready, applyHandoff])
}
