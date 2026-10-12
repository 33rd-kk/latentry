"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { useBulkTag } from "@/hooks/use-bulk-tag"
import type { GalleryPage } from "@/hooks/use-gallery"
import { useLocalFlag } from "@/hooks/use-local-flag"
import type { ImageTag } from "@/lib/image-meta"
import { useT } from "@/lib/i18n"

/**
 * Selection for bulk tagging, by file name within the folder on screen.
 * `selectionKey` names the folder and search: when it changes, the old
 * selection names other pictures and is dropped.
 */
export function useGallerySelection(dir: number | null, selectionKey: string, page: GalleryPage) {
  const t = useT()
  const [skipTagged, setSkipTagged] = useLocalFlag("latentry:bulk-skip-tagged", true)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [selectionFor, setSelectionFor] = useState(selectionKey)
  if (selectionFor !== selectionKey) {
    setSelectionFor(selectionKey)
    setSelected(new Set())
  }
  const toggleSelected = useCallback((name: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }, [])

  // Each finished picture shows its tags at once, without reloading the folder.
  const picturesRef = useRef(page.pictures)
  useEffect(() => {
    picturesRef.current = page.pictures
  }, [page.pictures])
  const { patch } = page
  const onTagged = useCallback(
    (name: string, tags: ImageTag[]) => {
      const picture = picturesRef.current.find((item) => item.name === name)
      if (picture) patch(picture, { ...(picture.meta ?? { source: "unknown", prompt: "", negativePrompt: "" }), tags })
    },
    [patch]
  )
  const bulk = useBulkTag(onTagged)

  const runBulkTag = useCallback(async () => {
    if (dir === null || selected.size === 0) return
    const names = page.pictures.filter((picture) => selected.has(picture.name)).map((picture) => picture.name)
    const result = await bulk.start(dir, names, skipTagged)
    if (!result.ok) toast.error(t("gallery.bulkFailed"), { description: result.error })
    else if (result.cancelled) toast(t("gallery.bulkCancelled"))
  }, [dir, selected, page.pictures, bulk, skipTagged, t])

  return { selecting, setSelecting, selected, setSelected, toggleSelected, skipTagged, setSkipTagged, bulk, runBulkTag }
}

export type GallerySelection = ReturnType<typeof useGallerySelection>
