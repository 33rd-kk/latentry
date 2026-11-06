"use client"

import { useState } from "react"
import { Download } from "lucide-react"
import { saveBlob, saveDownload, useGalleryFolders } from "@/hooks/use-gallery"
import { stripPngBytes } from "@/lib/image-meta/png-strip"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export interface SavablePicture {
  seed: number
  image_base64: string
  saved_name: string | null
}

/**
 * Where "Save with settings" fetches a picture from: the gallery's save
 * folder, which holds the copy with Latentry's record. Null until known, or
 * when there is no save folder.
 */
export function useSaveFolder(): number | null {
  const { folders } = useGalleryFolders()
  return folders?.find((folder) => folder.writable)?.index ?? null
}

function pngBytes(base64: string): Uint8Array {
  const text = atob(base64)
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i)
  return bytes
}

/**
 * Save without settings, made in this page from the picture it already has
 * (nothing is sent anywhere for it), and Save with settings, the gallery's
 * copy, offered once the picture is in the gallery.
 */
export function SavePicture({ image, saveFolder, className }: { image: SavablePicture; saveFolder: number | null; className?: string }) {
  const t = useT()
  const [note, setNote] = useState<string | null>(null)
  const name = image.saved_name ?? `latentry_${image.seed}.png`
  const action = "inline-flex items-center gap-1 hover:text-foreground"

  const saveClean = () => {
    setNote(null)
    const clean = stripPngBytes(pngBytes(image.image_base64))
    // Never the picture with its settings in place of a clean one.
    if (!clean) return setNote(t("gallery.download.notCleaned"))
    saveBlob(new Blob([clean as Uint8Array<ArrayBuffer>], { type: "image/png" }), name)
  }

  const saveOriginal = async () => {
    if (!image.saved_name || saveFolder === null) return
    setNote(null)
    const result = await saveDownload(`/api/gallery/${saveFolder}/${encodeURIComponent(image.saved_name)}?download=original`, undefined, name)
    if (!result.ok) setNote(t("gallery.download.failed", { error: t.server(result.error) }))
  }

  return (
    <>
      <button type="button" className={cn(action, className)} onClick={saveClean} title={t("gallery.download.cleanHint")}>
        <Download className="h-3 w-3" />
        {t("gallery.download.clean")}
      </button>
      {image.saved_name && saveFolder !== null && (
        <button type="button" className={cn(action, className)} onClick={() => void saveOriginal()} title={t("generate.saveOriginalHint")}>
          <Download className="h-3 w-3" />
          {t("gallery.download.original")}
        </button>
      )}
      {note && (
        <span role="status" className="basis-full text-destructive">
          {note}
        </span>
      )}
    </>
  )
}
