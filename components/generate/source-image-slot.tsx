"use client"

import { useCallback, useRef, useState } from "react"
import { Brush, ImagePlus, Images, Loader2, PersonStanding, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { GalleryPicker } from "@/components/gallery/gallery-picker"
import { useSecretMode } from "@/components/app-header"
import { fetchPicture } from "@/hooks/use-gallery"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"
import { MaskEditor } from "./mask-editor"

/**
 * What the source is for. "variation" redraws this picture (whole, or the
 * masked part); "pose" only borrows its composition and silhouette for a new
 * picture, so it runs at a higher strength and has no mask.
 */
export type SourceMode = "variation" | "pose"

/** The img2img source as it will be sent: a PNG data URL plus its size, for the hint under the preview. */
export interface SourceImage {
  dataUrl: string
  width: number
  height: number
}

// The output is sized to about the requested area anyway (see fitToImage in
// lib/profiles), so anything bigger is only request weight. 2048 keeps detail
// for the resize while staying well inside the body limit once base64-encoded.
const MAX_SOURCE_EDGE = 2048

/**
 * Decodes any browser-readable image into a PNG data URL no larger than
 * MAX_SOURCE_EDGE on its long side. Re-encoding also normalises whatever came
 * in (WebP, JPEG, an animated GIF's first frame) to one format every backend reads.
 */
export async function toSourceImage(blob: Blob): Promise<SourceImage> {
  const bitmap = await createImageBitmap(blob)
  try {
    const scale = Math.min(1, MAX_SOURCE_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext("2d")
    if (!context) throw new Error("2d canvas unavailable")
    context.drawImage(bitmap, 0, 0, width, height)
    return { dataUrl: canvas.toDataURL("image/png"), width, height }
  } finally {
    bitmap.close()
  }
}

interface SourceImageSlotProps {
  value: SourceImage | null
  onChange: (value: SourceImage | null) => void
  strength: number
  onStrengthChange: (value: number) => void
  /** Inpaint mask over the source (see MaskEditor); null redraws the whole image. */
  mask: string | null
  onMaskChange: (mask: string | null) => void
  mode: SourceMode
  onModeChange: (mode: SourceMode) => void
  /** Masks are only offered where the backend can inpaint. */
  canInpaint?: boolean
  disabled?: boolean
}

/**
 * The img2img source: drop or choose a file, or take one from the gallery.
 * Empty means plain text-to-image, so the strength slider only appears once
 * there is something for it to act on.
 */
export function SourceImageSlot({
  value,
  onChange,
  strength,
  onStrengthChange,
  mask,
  onMaskChange,
  mode,
  onModeChange,
  canInpaint = true,
  disabled,
}: SourceImageSlotProps) {
  const t = useT()
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragActive, setIsDragActive] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showGallery, setShowGallery] = useState(false)
  const [masking, setMasking] = useState(false)
  // Secret mode blurs the preview; a click shows this source, until it is
  // clicked again or another source takes its place. The mask editor is not
  // blurred: painting needs the picture, and it is opened on purpose.
  const secret = useSecretMode()
  const [shownSource, setShownSource] = useState<string | null>(null)
  const veiled = secret && value !== null && shownSource !== value.dataUrl

  const load = useCallback(
    async (source: Promise<Blob>) => {
      setLoading(true)
      setError(null)
      try {
        onChange(await toSourceImage(await source))
      } catch {
        setError(t("generate.sourceLoadFailed"))
      } finally {
        setLoading(false)
      }
    },
    [onChange, t]
  )

  const loadFile = useCallback(
    (file: File | undefined) => {
      if (!file) return
      if (!file.type.startsWith("image/")) {
        setError(t("generate.sourceLoadFailed"))
        return
      }
      void load(Promise.resolve(file))
    },
    [load, t]
  )

  const pickFromGallery = useCallback((url: string) => void load(fetchPicture(url)), [load])

  const clear = useCallback(() => {
    onChange(null)
    setError(null)
    setMasking(false)
  }, [onChange])

  // Closing the editor drops the mask too: a mask nobody can see any more would
  // still quietly turn the next run into an inpaint.
  const toggleMasking = useCallback(() => {
    if (masking) onMaskChange(null)
    setMasking(!masking)
  }, [masking, onMaskChange])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label>{t("generate.sourceImage")}</Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => setShowGallery(true)}
          disabled={disabled}
        >
          <Images className="mr-1 h-3.5 w-3.5" />
          {t("generate.sourceFromGallery")}
        </Button>
      </div>

      {value ? (
        <div className="flex items-start gap-3">
          {secret ? (
            <button
              type="button"
              className="h-28 w-28 shrink-0 overflow-hidden rounded-md border border-border/50 bg-muted/50"
              onClick={() => setShownSource(veiled ? value.dataUrl : null)}
              title={veiled ? t("generate.showPicture") : t("generate.pictureHidden")}
              aria-pressed={!veiled}
            >
              <img src={value.dataUrl} alt={t("generate.sourceImage")} className={cn("h-full w-full object-contain", veiled && "blur-xl")} />
            </button>
          ) : (
            <img
              src={value.dataUrl}
              alt={t("generate.sourceImage")}
              className="h-28 w-28 shrink-0 rounded-md border border-border/50 bg-muted/50 object-contain"
            />
          )}
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center justify-between gap-1 text-xs text-muted-foreground">
              <span>{value.width} × {value.height}</span>
              {mode === "variation" && canInpaint && (
                <Button
                  type="button"
                  variant={masking ? "secondary" : "ghost"}
                  size="sm"
                  className="ml-auto h-6 px-1.5 text-xs"
                  onClick={toggleMasking}
                  disabled={disabled}
                >
                  <Brush className="mr-1 h-3 w-3" />
                  {mask ? t("generate.maskOn") : t("generate.maskDraw")}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn("h-6 px-1.5 text-xs", mode === "pose" && "ml-auto")}
                onClick={clear}
                disabled={disabled}
              >
                <X className="mr-1 h-3 w-3" />
                {t("generate.sourceClear")}
              </Button>
            </div>
            <div className="flex gap-1" role="radiogroup" aria-label={t("generate.sourceMode")}>
              {(["variation", "pose"] as const).map((option) => (
                <Button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={mode === option}
                  size="sm"
                  variant={mode === option ? "secondary" : "ghost"}
                  className="h-6 flex-1 px-1.5 text-xs"
                  onClick={() => {
                    if (option === mode) return
                    // The editor belongs to "variation"; leaving it drops the mask.
                    setMasking(false)
                    onModeChange(option)
                  }}
                  disabled={disabled}
                >
                  {option === "pose" && <PersonStanding className="mr-1 h-3 w-3" />}
                  {t(option === "pose" ? "generate.sourceModePose" : "generate.sourceModeVariation")}
                </Button>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label>{t("generate.strength", { value: strength.toFixed(2) })}</Label>
              <Slider
                min={0.05}
                max={1}
                step={0.05}
                value={[strength]}
                onValueChange={([v]) => onStrengthChange(v)}
                disabled={disabled}
              />
              <p className="text-xs text-muted-foreground">
                {t(mode === "pose" ? "generate.poseHint" : "generate.strengthHint")}
              </p>
            </div>
          </div>
        </div>
      ) : (
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
            loadFile(event.dataTransfer.files[0])
          }}
          disabled={disabled || loading}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-md border border-dashed px-3 py-4 text-xs text-muted-foreground transition",
            isDragActive ? "border-primary bg-primary/5" : "hover:border-muted-foreground/60"
          )}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
          {t("generate.sourceDrop")}
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          loadFile(event.currentTarget.files?.[0])
          // Cleared so choosing the same file again still fires onChange.
          event.currentTarget.value = ""
        }}
      />

      {value && masking && mode === "variation" && <MaskEditor source={value} onChange={onMaskChange} disabled={disabled} />}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <GalleryPicker
        open={showGallery}
        onOpenChange={setShowGallery}
        title={t("generate.sourceFromGallery")}
        onPick={pickFromGallery}
      />
    </div>
  )
}
