"use client"

import { useId } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SliderLabel } from "@/components/generate/slider-label"
import { Slider } from "@/components/ui/slider"
import { DETECTOR_CONFIDENCE, FACE_DETECTORS, FACE_FIX_DEFAULTS, FACE_FIX_LIMITS, type FaceFixOptions } from "@/lib/generate/facefix"
import { useT } from "@/lib/i18n"

interface FaceFixControlsProps {
  value: FaceFixOptions
  onChange: (value: FaceFixOptions) => void
  disabled?: boolean
}

/**
 * Face fix's knobs: which detector finds the faces, how sure it must be, how
 * many faces at most, how much of each is redrawn, and an optional prompt for
 * the faces. The faces are found and redrawn on the server (lib/facefix).
 */
export function FaceFixControls({ value, onChange, disabled }: FaceFixControlsProps) {
  const t = useT()
  const id = useId()
  const set = (patch: Partial<FaceFixOptions>) => onChange({ ...value, ...patch })
  const defaultConfidence = DETECTOR_CONFIDENCE[value.detector]
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label id={`${id}-detector`}>{t("generate.facefix.detector")}</Label>
        <div className="flex gap-1" role="radiogroup" aria-labelledby={`${id}-detector`}>
          {FACE_DETECTORS.map((detector) => (
            <Button
              key={detector}
              type="button"
              role="radio"
              aria-checked={value.detector === detector}
              size="sm"
              variant={value.detector === detector ? "secondary" : "ghost"}
              className="h-6 flex-1 px-1.5 text-xs"
              // Each detector has its own sure-enough score.
              onClick={() => set({ detector, confidence: DETECTOR_CONFIDENCE[detector] })}
              disabled={disabled}
            >
              {t(detector === "photo" ? "generate.facefix.photo" : "generate.facefix.anime")}
            </Button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <div className="space-y-1.5">
          <SliderLabel
            id={`${id}-denoise`}
            value={value.denoise}
            defaultValue={FACE_FIX_DEFAULTS.denoise}
            shown={FACE_FIX_DEFAULTS.denoise.toFixed(2)}
            onReset={() => set({ denoise: FACE_FIX_DEFAULTS.denoise })}
            disabled={disabled}
          >
            {t("generate.facefix.denoise", { value: value.denoise.toFixed(2) })}
          </SliderLabel>
          <Slider
            aria-labelledby={`${id}-denoise`}
            min={FACE_FIX_LIMITS.minDenoise}
            max={FACE_FIX_LIMITS.maxDenoise}
            step={0.05}
            value={[value.denoise]}
            onValueChange={([denoise]) => set({ denoise })}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <SliderLabel
            id={`${id}-faces`}
            value={value.maxFaces}
            defaultValue={FACE_FIX_DEFAULTS.maxFaces}
            onReset={() => set({ maxFaces: FACE_FIX_DEFAULTS.maxFaces })}
            disabled={disabled}
          >
            {t("generate.facefix.maxFaces", { value: value.maxFaces })}
          </SliderLabel>
          <Slider
            aria-labelledby={`${id}-faces`}
            min={1}
            max={FACE_FIX_LIMITS.maxFaces}
            step={1}
            value={[value.maxFaces]}
            onValueChange={([maxFaces]) => set({ maxFaces })}
            disabled={disabled}
          />
        </div>
        <div className="col-span-2 space-y-1.5">
          <SliderLabel
            id={`${id}-confidence`}
            value={value.confidence}
            defaultValue={defaultConfidence}
            shown={defaultConfidence.toFixed(2)}
            onReset={() => set({ confidence: defaultConfidence })}
            disabled={disabled}
          >
            {t("generate.facefix.confidence", { value: value.confidence.toFixed(2) })}
          </SliderLabel>
          <Slider
            aria-labelledby={`${id}-confidence`}
            min={FACE_FIX_LIMITS.minConfidence}
            max={FACE_FIX_LIMITS.maxConfidence}
            step={0.05}
            value={[value.confidence]}
            onValueChange={([confidence]) => set({ confidence })}
            disabled={disabled}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-prompt`}>{t("generate.facefix.prompt")}</Label>
        <Input
          id={`${id}-prompt`}
          value={value.prompt}
          maxLength={FACE_FIX_LIMITS.maxPrompt}
          onChange={(event) => set({ prompt: event.target.value })}
          placeholder={t("generate.facefix.promptPlaceholder")}
          disabled={disabled}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {t("generate.facefix.hint")}{" "}
        <Link href="/setup#face-detectors" className="underline underline-offset-2">
          {t("generate.facefix.setupLink")}
        </Link>
      </p>
    </div>
  )
}
