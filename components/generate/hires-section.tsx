"use client"

import { useId } from "react"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { SliderLabel } from "@/components/generate/slider-label"
import { HIRES_DEFAULTS, hiresSize, maxHiresScale } from "@/lib/diffusion/hires"
import type { FormState } from "@/lib/generate/form"
import { useT } from "@/lib/i18n"

interface HiresSectionProps {
  form: FormState
  update: (patch: Partial<FormState>) => void
  /** The backend's upscalers; the select is left out when it offers one or none. */
  upscalers: string[]
  /** The upscaler as the backend accepts it. */
  upscaler: string
  sizeMultiple: number
  disabled?: boolean
  /**
   * Upscale of a source picture: no switch or frame (it sits in the source
   * slot), sized from `base`, the source's size, and up to `maxScale`.
   */
  embedded?: { base: { width: number; height: number }; maxScale: number }
}

/**
 * Hires fix: a switch, and while it is on the second pass's knobs. The first
 * pass draws at the size above; this one upscales it and redraws the detail.
 * Embedded in the source slot, the same knobs upscale the source itself.
 */
export function HiresSection({ form, update, upscalers, upscaler, sizeMultiple, disabled, embedded }: HiresSectionProps) {
  const t = useT()
  const sliderId = useId()
  const base = embedded?.base ?? { width: form.width, height: form.height }
  const maxScale = Math.max(1, Math.floor(Math.min(embedded?.maxScale ?? 2, maxHiresScale(base.width, base.height)) * 20) / 20)
  const scale = Math.min(form.hrScale, maxScale)
  const target = hiresSize(base.width, base.height, scale, sizeMultiple)
  const on = embedded ? true : form.hires
  return (
    <div className={embedded ? "space-y-3" : "space-y-3 rounded-md border px-3 py-2.5"}>
      {embedded ? (
        <p className="text-xs text-muted-foreground">{t("generate.upscaleHint")}</p>
      ) : (
        <label className="flex items-center justify-between gap-2 text-sm font-medium">
          {t("generate.hires.title")}
          <Switch checked={form.hires} onCheckedChange={(hires) => update({ hires })} disabled={disabled} />
        </label>
      )}
      {!on ? (
        <p className="text-xs text-muted-foreground">{t("generate.hires.hint")}</p>
      ) : (
        <>
          {upscalers.length > 1 && (
            <div className="space-y-1.5">
              <Label htmlFor={`${sliderId}-upscaler`}>{t("generate.hires.upscaler")}</Label>
              <Select value={upscaler} onValueChange={(value) => update({ hrUpscaler: value })} disabled={disabled}>
                <SelectTrigger id={`${sliderId}-upscaler`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {upscalers.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <SliderLabel
              id={`${sliderId}-0`}
              value={scale}
              defaultValue={Math.min(HIRES_DEFAULTS.scale, maxScale)}
              shown={Math.min(HIRES_DEFAULTS.scale, maxScale).toFixed(2)}
              onReset={() => update({ hrScale: HIRES_DEFAULTS.scale })}
            >
              {t("generate.hires.scale", { value: scale.toFixed(2), width: target.width, height: target.height })}
            </SliderLabel>
            <Slider aria-labelledby={`${sliderId}-0`} min={1} max={maxScale} step={0.05} value={[scale]} onValueChange={([value]) => update({ hrScale: value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <SliderLabel id={`${sliderId}-1`} value={form.hrSteps} defaultValue={HIRES_DEFAULTS.steps} onReset={() => update({ hrSteps: HIRES_DEFAULTS.steps })}>
                {form.hrSteps
                  ? t("generate.hires.steps", { value: form.hrSteps })
                  : t("generate.hires.stepsSame", { value: form.steps })}
              </SliderLabel>
              <Slider aria-labelledby={`${sliderId}-1`} min={0} max={100} step={1} value={[form.hrSteps]} onValueChange={([value]) => update({ hrSteps: value })} />
            </div>
            <div className="space-y-1.5">
              <SliderLabel
                id={`${sliderId}-2`}
                value={form.hrDenoise}
                defaultValue={HIRES_DEFAULTS.denoise}
                shown={HIRES_DEFAULTS.denoise.toFixed(2)}
                onReset={() => update({ hrDenoise: HIRES_DEFAULTS.denoise })}
              >
                {t("generate.hires.denoise", { value: form.hrDenoise.toFixed(2) })}
              </SliderLabel>
              <Slider aria-labelledby={`${sliderId}-2`} min={0.05} max={1} step={0.01} value={[form.hrDenoise]} onValueChange={([value]) => update({ hrDenoise: value })} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
