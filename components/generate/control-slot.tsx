"use client"

import { useCallback, useEffect, useId, useRef, useState } from "react"
import { Images, Loader2, Waypoints, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { GalleryPicker } from "@/components/gallery/gallery-picker"
import { fetchPicture } from "@/hooks/use-gallery"
import { CONTROL_STRENGTH, type ControlKind } from "@/lib/control/kinds"
import { useT } from "@/lib/i18n"
import { PoseDropZone } from "./pose-drop-zone"
import { SliderLabel } from "./slider-label"
import { toSourceImage, type SourceImage } from "./source-image-slot"

/** The control picture a run follows: made by Latentry from a reference (POST /api/control). */
export interface ControlPicture {
  kind: ControlKind
  /** A PNG data URL, white on black. */
  dataUrl: string
  width: number
  height: number
}

interface ControlSlotProps {
  /** The kinds this backend follows; the first is chosen when none is. */
  kinds: readonly ControlKind[]
  value: ControlPicture | null
  onChange: (value: ControlPicture | null) => void
  strength: number
  onStrengthChange: (value: number) => void
  /** The img2img source, offered as a one-click reference. */
  source: SourceImage | null
  disabled?: boolean
}

/**
 * A control picture beside the prompt: edges, a depth map or line art, made
 * by Latentry from a reference picture (on this computer, lib/control). The
 * reference stays in this page's memory only; the control picture shown is
 * exactly what the run sends.
 */
export function ControlSlot({ kinds, value, onChange, strength, onStrengthChange, source, disabled }: ControlSlotProps) {
  const t = useT()
  const id = useId()
  const [showGallery, setShowGallery] = useState(false)
  const [reference, setReference] = useState<SourceImage | null>(null)
  const [kind, setKind] = useState<ControlKind>(value?.kind ?? kinds[0] ?? "canny")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Only the latest ask is applied: a slow depth map must not land after a quick Canny asked later.
  const asked = useRef(0)
  const chosen = kinds.includes(kind) ? kind : (kinds[0] ?? "canny")

  const make = useCallback(
    async (picture: SourceImage, which: ControlKind) => {
      const ask = ++asked.current
      setLoading(true)
      setError(null)
      try {
        const response = await fetch("/api/control", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: which, image_base64: picture.dataUrl }),
        })
        const answer = await response.json().catch(() => null)
        if (ask !== asked.current) return
        if (!response.ok || typeof answer?.image_base64 !== "string") {
          setError(typeof answer?.error === "string" ? t.server(answer.error) : t("generate.control.failed"))
          return
        }
        onChange({ kind: which, dataUrl: `data:image/png;base64,${answer.image_base64}`, width: answer.width, height: answer.height })
      } catch {
        if (ask === asked.current) setError(t("generate.control.failed"))
      } finally {
        if (ask === asked.current) setLoading(false)
      }
    },
    [onChange, t]
  )

  const take = useCallback(
    async (picture: Promise<Blob>) => {
      try {
        const next = await toSourceImage(await picture)
        setReference(next)
        await make(next, chosen)
      } catch {
        setError(t("generate.control.failed"))
      }
    },
    [chosen, make, t]
  )

  // A kind the backend no longer offers is dropped with its picture.
  useEffect(() => {
    if (value && !kinds.includes(value.kind)) onChange(null)
  }, [kinds, value, onChange])

  const pickKind = (next: ControlKind) => {
    setKind(next)
    if (reference) void make(reference, next)
    else if (value) onChange(null)
  }

  const clear = () => {
    asked.current += 1
    setReference(null)
    setLoading(false)
    setError(null)
    onChange(null)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="flex items-center gap-1" id={`${id}-kind`}>
          <Waypoints className="h-3.5 w-3.5" />
          {t("generate.control.title")}
        </Label>
        <div className="flex items-center gap-1">
          {source && (
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => void take(fetch(source.dataUrl).then((r) => r.blob()))} disabled={disabled || loading}>
              {t("generate.control.fromSource")}
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setShowGallery(true)} disabled={disabled}>
            <Images className="mr-1 h-3.5 w-3.5" />
            {t("generate.control.fromGallery")}
          </Button>
        </div>
      </div>

      <div className="flex gap-1" role="radiogroup" aria-labelledby={`${id}-kind`}>
        {kinds.map((option) => (
          <Button
            key={option}
            type="button"
            role="radio"
            aria-checked={chosen === option}
            size="sm"
            variant={chosen === option ? "secondary" : "ghost"}
            className="h-6 flex-1 px-1.5 text-xs"
            onClick={() => pickKind(option)}
            disabled={disabled || loading}
          >
            {t(`generate.control.kind.${option}`)}
          </Button>
        ))}
      </div>

      {value ? (
        <div className="space-y-2">
          <div className="flex items-start gap-3">
            {/* The exact picture the run sends. */}
            <img
              src={value.dataUrl}
              alt={t("generate.control.preview", { kind: t(`generate.control.kind.${value.kind}`) })}
              className="max-h-40 w-auto rounded border bg-black"
            />
            <div className="flex flex-col gap-1">
              {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={clear} disabled={disabled}>
                <X className="mr-1 h-3 w-3" />
                {t("generate.sourceClear")}
              </Button>
            </div>
          </div>
          <SliderLabel
            id={`${id}-strength`}
            value={strength}
            defaultValue={CONTROL_STRENGTH.default}
            shown={CONTROL_STRENGTH.default.toFixed(2)}
            onReset={() => onStrengthChange(CONTROL_STRENGTH.default)}
            disabled={disabled}
          >
            {t("generate.control.strength", { value: strength.toFixed(2) })}
          </SliderLabel>
          <Slider
            aria-labelledby={`${id}-strength`}
            min={CONTROL_STRENGTH.min}
            max={CONTROL_STRENGTH.max}
            step={0.05}
            value={[strength]}
            onValueChange={([next]) => onStrengthChange(next)}
            disabled={disabled}
          />
        </div>
      ) : (
        <PoseDropZone
          onFile={(file) => void take(Promise.resolve(file))}
          loading={loading}
          disabled={disabled}
          label={t("generate.control.drop")}
          icon={<Waypoints className="h-4 w-4" />}
        />
      )}
      <p className="text-xs text-muted-foreground">{t("generate.control.hint")}</p>
      {error && <p className="text-xs text-destructive">{error}</p>}

      <GalleryPicker
        open={showGallery}
        onOpenChange={setShowGallery}
        title={t("generate.control.fromGallery")}
        onPick={(url) => void take(fetchPicture(url))}
      />
    </div>
  )
}
