"use client"

import { useId } from "react"
import { SliderLabel } from "@/components/generate/slider-label"
import { Slider } from "@/components/ui/slider"
import { outpaintCanvas, outpaintRoom, OUTPAINT_SIDES, OUTPAINT_STEP, type OutpaintSides } from "@/lib/generate/outpaint"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"
import type { SourceImage } from "./source-image-slot"

interface ExtendControlsProps {
  source: SourceImage
  sides: OutpaintSides
  onChange: (sides: OutpaintSides) => void
  /** Blur the preview, as the source is in secret mode. */
  veiled: boolean
  disabled?: boolean
}

const LABELS = { left: "generate.extendLeft", right: "generate.extendRight", top: "generate.extendTop", bottom: "generate.extendBottom" } as const

/**
 * How far the canvas grows on each side, with a preview of the new canvas:
 * the source in place, the new area hatched. The server pads and masks it
 * (lib/generate/outpaint-image.ts); each side is held so the canvas stays
 * within the largest size a backend draws.
 */
export function ExtendControls({ source, sides, onChange, veiled, disabled }: ExtendControlsProps) {
  const t = useT()
  const sliderId = useId()
  const canvas = outpaintCanvas(source, sides)
  const percent = (value: number, of: number) => `${(value / of) * 100}%`
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div
          className="relative w-24 shrink-0 overflow-hidden rounded-sm border border-dashed border-muted-foreground/50 bg-[repeating-linear-gradient(45deg,transparent_0_4px,var(--color-muted)_4px_8px)]"
          style={{ aspectRatio: `${canvas.width} / ${canvas.height}` }}
          aria-hidden
        >
          <img
            src={source.dataUrl}
            alt=""
            className={cn("absolute object-fill", veiled && "blur-md")}
            style={{
              left: percent(canvas.pad.left, canvas.width),
              top: percent(canvas.pad.top, canvas.height),
              width: percent(source.width, canvas.width),
              height: percent(source.height, canvas.height),
            }}
          />
        </div>
        <p className="text-xs text-muted-foreground">{t("generate.extendSize", { width: canvas.width, height: canvas.height })}</p>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {OUTPAINT_SIDES.map((side, index) => (
          <div key={side} className="space-y-1.5">
            <SliderLabel
              id={`${sliderId}-${index}`}
              value={sides[side]}
              defaultValue={0}
              onReset={() => onChange({ ...sides, [side]: 0 })}
              disabled={disabled}
            >
              {t(LABELS[side], { value: sides[side] })}
            </SliderLabel>
            <Slider
              aria-labelledby={`${sliderId}-${index}`}
              min={0}
              max={Math.max(OUTPAINT_STEP, outpaintRoom(source, sides, side))}
              step={OUTPAINT_STEP}
              value={[sides[side]]}
              onValueChange={([value]) => onChange({ ...sides, [side]: Math.min(value, outpaintRoom(source, sides, side)) })}
              disabled={disabled || outpaintRoom(source, sides, side) === 0}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
