"use client"

import { useState } from "react"
import { ArrowLeftRight, Dices } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { CUSTOM_PRESET, DEFAULT, type FormState } from "@/lib/generate/form"
import type { Profile } from "@/lib/profiles"
import type { BackendStatus, Preset } from "@/lib/backends/types"
import { useT } from "@/lib/i18n"

interface SettingsSectionProps {
  form: FormState
  profile: Profile
  status: BackendStatus
  update: (patch: Partial<FormState>) => void
  disabled: boolean
  /** With a source image only the tail of the schedule runs: how many steps that is, or null without one. */
  img2imgSteps: number | null
  presetList: Preset[]
  onPresetChange: (name: string, available: Preset[]) => void
  /** The sampler and scheduler as the backend accepts them. */
  sampler: string
  scheduler: string
}

/** The knobs: size, seed, steps, image count, speed preset, sampler and scheduler, CFG. */
export function SettingsSection({
  form,
  profile,
  status,
  update,
  disabled,
  img2imgSteps,
  presetList,
  onPresetChange,
  sampler,
  scheduler,
}: SettingsSectionProps) {
  const t = useT()
  const selectedPreset = presetList.find((preset) => preset.name === form.presetName) ?? null
  return (
    <>
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1">
          {profile.resolutions.map(([w, h]) => (
            <Button
              key={`${w}x${h}`}
              type="button"
              size="sm"
              variant={form.width === w && form.height === h ? "secondary" : "ghost"}
              className="h-6 px-1.5 font-mono text-[11px]"
              onClick={() => update({ width: w, height: h })}
              disabled={disabled}
            >
              {w}×{h}
            </Button>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <Label>{t("generate.width", { value: form.width })}</Label>
            <Slider min={256} max={2048} step={64} value={[form.width]} onValueChange={([value]) => update({ width: value })} />
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => update({ width: form.height, height: form.width })}
                aria-label={t("generate.swapDimensions")}
                className="shrink-0"
              >
                <ArrowLeftRight className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("generate.swapDimensions")}</TooltipContent>
          </Tooltip>
          <div className="flex-1 space-y-1.5">
            <Label>{t("generate.height", { value: form.height })}</Label>
            <Slider min={256} max={2048} step={64} value={[form.height]} onValueChange={([value]) => update({ height: value })} />
          </div>
        </div>
        {(form.width % profile.sizeMultiple !== 0 || form.height % profile.sizeMultiple !== 0) && (
          <p className="text-xs text-amber-600 dark:text-amber-500">
            {t("generate.sizeMultiple", { multiple: profile.sizeMultiple })}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="seed">{t("generate.seed")}</Label>
          <div className="flex gap-2">
            <SeedInput value={form.seed} onChange={(seed) => update({ seed })} />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => update({ seed: -1 })}
                  disabled={form.seed === -1}
                  aria-label={t("generate.randomSeed")}
                  className="shrink-0"
                >
                  <Dices className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("generate.randomSeed")}</TooltipContent>
            </Tooltip>
          </div>
        </div>
        <div className="space-y-1.5">
          {/* With a source, only the tail of the schedule runs; the label says
              so, or it would disagree with the progress bar's count. */}
          <Label>
            {img2imgSteps !== null
              ? t("generate.stepsI2i", { value: form.steps, actual: img2imgSteps })
              : t("generate.steps", { value: form.steps })}
          </Label>
          <Slider
            min={1}
            max={100}
            step={1}
            value={[form.steps]}
            onValueChange={([value]) => update({ steps: value, presetName: CUSTOM_PRESET })}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>{t("generate.imageCount", { value: form.imageCount })}</Label>
        <Slider min={1} max={16} step={1} value={[form.imageCount]} onValueChange={([value]) => update({ imageCount: value })} />
      </div>

      {presetList.length > 0 && (
        <div className="space-y-1.5">
          <Label>{t("generate.speedPreset")}</Label>
          <Select value={form.presetName} onValueChange={(name) => onPresetChange(name, presetList)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {presetList.map((preset) => (
                <SelectItem key={preset.name} value={preset.name}>
                  {preset.label} — ~{Math.round(preset.approx_seconds)}s
                </SelectItem>
              ))}
              <SelectItem value={CUSTOM_PRESET}>{t("generate.custom")}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{selectedPreset ? selectedPreset.description : t("generate.customHint")}</p>
        </div>
      )}

      {(status.samplers.length > 0 || status.schedulers.length > 0) && (
        <div className="grid grid-cols-2 gap-4">
          {status.samplers.length > 0 && (
            <div className="space-y-1.5">
              <Label>{t("generate.sampler")}</Label>
              <Select value={sampler} onValueChange={(value) => update({ sampler: value, presetName: CUSTOM_PRESET })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {status.samplers.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option === DEFAULT ? t("generate.backendDefault") : option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {status.schedulers.length > 0 && (
            <div className="space-y-1.5">
              <Label>{t("generate.scheduler")}</Label>
              <Select value={scheduler} onValueChange={(value) => update({ scheduler: value, presetName: CUSTOM_PRESET })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {status.schedulers.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option === DEFAULT ? t("generate.backendDefault") : option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        <Label>{t("generate.guidanceScale", { value: form.cfg.toFixed(1) })}</Label>
        <Slider min={1} max={15} step={0.1} value={[form.cfg]} onValueChange={([value]) => update({ cfg: value })} />
      </div>
    </>
  )
}

/**
 * Keeps the typed text apart from the number: "" and "-" are steps on the way
 * to "-1", and turning them into 0 on every keystroke made -1 unreachable.
 */
function SeedInput({ value, onChange }: { value: number; onChange: (seed: number) => void }) {
  const [text, setText] = useState(String(value))
  const [shown, setShown] = useState(value)

  // A preset or handoff can change the seed from outside; show it unless the
  // text already means the same number. Adjusted while rendering, as React
  // recommends for state that follows a prop, rather than in an effect.
  if (shown !== value) {
    setShown(value)
    if (!(Number(text) === value && text.trim() !== "")) setText(String(value))
  }

  return (
    <Input
      id="seed"
      type="text"
      inputMode="numeric"
      value={text}
      onChange={(event) => {
        const next = event.target.value
        if (!/^-?\d*$/.test(next)) return
        setText(next)
        if (/^-?\d+$/.test(next)) onChange(Number(next))
      }}
      onBlur={() => setText(String(value))}
    />
  )
}
