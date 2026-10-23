"use client"

import { useId } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { GRID_AXES, gridErrorParts, gridSize, splitValues, type GridAxisKind, type GridSpec, type GridError } from "@/lib/generate/grid"
import { useT } from "@/lib/i18n"

/** The grid as the form holds it: on or off, and each axis as typed. */
export interface GridForm {
  on: boolean
  x: { kind: GridAxisKind; text: string }
  y: { kind: GridAxisKind | "none"; text: string }
}

/** What an axis starts with when it is picked: a typical spread for a number, nothing for names and text. */
const STARTING_VALUES: Record<string, string> = {
  cfg: "4, 6, 8",
  steps: "20, 30, 40",
  seed: "1, 2, 3",
  hr_denoise: "0.3, 0.45, 0.6",
}

export const DEFAULT_GRID_FORM: GridForm = {
  on: false,
  x: { kind: "cfg", text: "4, 6, 8" },
  y: { kind: "none", text: "" },
}

interface GridSectionProps {
  value: GridForm
  onChange: (next: GridForm) => void
  /** What the grid would run, or why it cannot, as the page read it. */
  parsed: { ok: true; value: GridSpec } | { ok: false; error: GridError } | null
  imageCount: number
  /** The backend's lists, for the sampler and scheduler axes; an empty one leaves that axis out. */
  samplers: string[]
  schedulers: string[]
  /** Hires denoise is an axis only while hires fix is on. */
  hires: boolean
}

/**
 * The X/Y grid: a switch, and while it is on the two axes. Each axis names a
 * setting and its values; the run is drawn once per value (per pair of
 * values, with both), all on the same seed.
 */
export function GridSection({ value, onChange, parsed, imageCount, samplers, schedulers, hires }: GridSectionProps) {
  const t = useT()
  const id = useId()
  const offered = GRID_AXES.filter(
    (kind) => (kind !== "sampler" || samplers.length > 0) && (kind !== "scheduler" || schedulers.length > 0) && (kind !== "hr_denoise" || hires)
  )
  const size = parsed?.ok ? gridSize(parsed.value, imageCount) : null

  const axis = (which: "x" | "y") => {
    const current = value[which]
    const kind = current.kind
    const names = kind === "sampler" ? samplers : kind === "scheduler" ? schedulers : null
    const chosen = new Set(splitValues(current.text))
    const set = (patch: Partial<GridForm["y"]>) => onChange({ ...value, [which]: { ...current, ...patch } })
    const toggle = (name: string) => {
      const list = splitValues(current.text)
      set({ text: (chosen.has(name) ? list.filter((item) => item !== name) : [...list, name]).join(", ") })
    }
    return (
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-${which}`}>{t(which === "x" ? "generate.grid.x" : "generate.grid.y")}</Label>
        <div className="flex gap-2">
          <Select
            value={kind}
            onValueChange={(next) => set({ kind: next as GridAxisKind | "none", text: next === kind ? current.text : (STARTING_VALUES[next] ?? "") })}
          >
            <SelectTrigger className="w-40 shrink-0" aria-label={t(which === "x" ? "generate.grid.x" : "generate.grid.y")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {which === "y" && <SelectItem value="none">{t("generate.grid.none")}</SelectItem>}
              {offered.map((option) => (
                <SelectItem key={option} value={option}>
                  {t(`generate.grid.axis.${option}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {kind !== "none" && (
            <Input
              id={`${id}-${which}`}
              value={current.text}
              onChange={(event) => set({ text: event.target.value })}
              placeholder={kind === "prompt_sr" ? "red hair, blue hair" : kind === "sampler" || kind === "scheduler" ? "" : "20-40:5"}
              aria-label={t("generate.grid.values")}
            />
          )}
        </div>
        {names && (
          <div className="flex flex-wrap gap-1">
            {names.map((name) => (
              <button
                key={name}
                type="button"
                aria-pressed={chosen.has(name)}
                onClick={() => toggle(name)}
                className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-foreground"
              >
                {name}
              </button>
            ))}
          </div>
        )}
        {kind !== "none" && !names && (
          <p className="text-xs text-muted-foreground">{t(kind === "prompt_sr" ? "generate.grid.hintPrompt" : "generate.grid.hintNumbers")}</p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-md border px-3 py-2.5">
      <label className="flex items-center justify-between gap-2 text-sm font-medium">
        {t("generate.grid.title")}
        <Switch checked={value.on} onCheckedChange={(on) => onChange({ ...value, on })} aria-label={t("generate.grid.on")} />
      </label>
      {!value.on ? (
        <p className="text-xs text-muted-foreground">{t("generate.grid.onHint")}</p>
      ) : (
        <>
          {axis("x")}
          {axis("y")}
          {parsed && !parsed.ok ? (
            <p className="text-xs text-destructive" role="alert">
              {t(...gridErrorParts(parsed.error))}
            </p>
          ) : (
            size && <p className="text-xs text-muted-foreground">{t("generate.grid.size", { cells: size.cells, images: size.images })}</p>
          )}
        </>
      )}
    </div>
  )
}
