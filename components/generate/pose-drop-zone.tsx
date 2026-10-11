"use client"

import { useRef, useState } from "react"
import { Loader2, PersonStanding } from "lucide-react"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"

interface PoseDropZoneProps {
  /** A picture was dropped or chosen; only images are passed on. */
  onFile: (file: File) => void
  loading: boolean
  disabled?: boolean
}

/** The empty pose slot: drop a picture on it, or click to choose one. */
export function PoseDropZone({ onFile, loading, disabled }: PoseDropZoneProps) {
  const t = useT()
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragActive, setIsDragActive] = useState(false)

  const take = (file: File | undefined) => {
    if (file && file.type.startsWith("image/")) onFile(file)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault()
          setIsDragActive(true)
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setIsDragActive(false)}
        onDrop={(event) => {
          event.preventDefault()
          setIsDragActive(false)
          take(event.dataTransfer.files[0])
        }}
        disabled={disabled || loading}
        className={cn(
          "flex w-full items-center justify-center gap-2 rounded-md border border-dashed px-3 py-3 text-xs text-muted-foreground transition",
          isDragActive ? "border-primary bg-primary/5" : "hover:border-muted-foreground/60"
        )}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <PersonStanding className="h-4 w-4" />}
        {t("generate.poseDrop")}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          take(event.currentTarget.files?.[0])
          event.currentTarget.value = ""
        }}
      />
    </>
  )
}
