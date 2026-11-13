"use client"

import { useId, useState } from "react"
import { Images, Palette, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { GalleryPicker } from "@/components/gallery/gallery-picker"
import { useSecretMode, useShownInSecret } from "@/components/app-header"
import { fetchPicture } from "@/hooks/use-gallery"
import { IP_ADAPTER_SCALE } from "@/lib/control/kinds"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { PoseDropZone } from "./pose-drop-zone"
import { SliderLabel } from "./slider-label"
import { toSourceImage, type SourceImage } from "./source-image-slot"

interface ReferenceSlotProps {
  value: SourceImage | null
  onChange: (value: SourceImage | null) => void
  scale: number
  onScaleChange: (value: number) => void
  /** The img2img source, offered as a one-click reference. */
  source: SourceImage | null
}

/**
 * IP-Adapter: a reference picture whose look (colours, style, a character's
 * appearance) the run takes, at `scale`. Unlike a control picture, the
 * reference itself goes to the backend; in this page it lives in memory only.
 */
export function ReferenceSlot({ value, onChange, scale, onScaleChange, source }: ReferenceSlotProps) {
  const t = useT()
  const id = useId()
  const [showGallery, setShowGallery] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Secret mode blurs the reference, as the gallery's pictures; "Show" lifts it for this one.
  const secret = useSecretMode()
  const [shown, setShown] = useShownInSecret<string>()
  const veiled = secret && value !== null && shown !== value.dataUrl

  const take = async (picture: Promise<Blob>) => {
    setLoading(true)
    setError(null)
    try {
      onChange(await toSourceImage(await picture))
    } catch {
      setError(t("generate.reference.failed"))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="flex items-center gap-1">
          <Palette className="h-3.5 w-3.5" />
          {t("generate.reference.title")}
        </Label>
        <div className="flex items-center gap-1">
          {source && (
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onChange(source)} disabled={loading}>
              {t("generate.reference.fromSource")}
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setShowGallery(true)}>
            <Images className="mr-1 h-3.5 w-3.5" />
            {t("generate.reference.fromGallery")}
          </Button>
        </div>
      </div>

      {value ? (
        <div className="space-y-2">
          <div className="flex items-start gap-3">
            <button
              type="button"
              className="shrink-0"
              title={veiled ? t("generate.reference.show") : undefined}
              onClick={() => secret && setShown(veiled ? value.dataUrl : null)}
            >
              <img src={value.dataUrl} alt={t("generate.reference.alt")} className={cn("max-h-32 w-auto rounded border", veiled && "blur-md")} />
            </button>
            <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={() => onChange(null)}>
              <X className="mr-1 h-3 w-3" />
              {t("generate.sourceClear")}
            </Button>
          </div>
          <SliderLabel
            id={`${id}-scale`}
            value={scale}
            defaultValue={IP_ADAPTER_SCALE.default}
            shown={IP_ADAPTER_SCALE.default.toFixed(2)}
            onReset={() => onScaleChange(IP_ADAPTER_SCALE.default)}
          >
            {t("generate.reference.scale", { value: scale.toFixed(2) })}
          </SliderLabel>
          <Slider aria-labelledby={`${id}-scale`} min={IP_ADAPTER_SCALE.min} max={IP_ADAPTER_SCALE.max} step={0.05} value={[scale]} onValueChange={([next]) => onScaleChange(next)} />
        </div>
      ) : (
        <PoseDropZone onFile={(file) => void take(Promise.resolve(file))} loading={loading} label={t("generate.reference.drop")} icon={<Palette className="h-4 w-4" />} />
      )}
      <p className="text-xs text-muted-foreground">{t("generate.reference.hint")}</p>
      {error && <p className="text-xs text-destructive">{error}</p>}

      <GalleryPicker open={showGallery} onOpenChange={setShowGallery} title={t("generate.reference.fromGallery")} onPick={(url) => void take(fetchPicture(url))} />
    </div>
  )
}
