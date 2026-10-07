"use client"

import { ArrowDownUp, SlidersHorizontal, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  activeFilterCount,
  FORMATS,
  ORIENTATIONS,
  RESOLUTIONS,
  SINCE,
  SOURCES,
  type Format,
  type GalleryQuery,
} from "@/lib/gallery/filter"
import { SORT_KEYS, type SortKey } from "@/lib/gallery/sort"
import type { IndexProgress } from "@/lib/gallery/fs"
import type { Facets } from "@/lib/gallery/folder-index"
import { useT } from "@/lib/i18n"

const ALL = "__all__"

/** The order of the pictures, in the toolbar. */
export function SortSelect({ value, onChange }: { value: SortKey; onChange: (sort: SortKey) => void }) {
  const t = useT()
  return (
    <Select value={value} onValueChange={(next) => onChange(next as SortKey)}>
      <SelectTrigger className="w-44" aria-label={t("gallery.sort.label")}>
        <ArrowDownUp className="h-4 w-4 text-muted-foreground" />
        <span className="flex-1 text-left">
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent>
        {SORT_KEYS.map((key) => (
          <SelectItem key={key} value={key}>
            {t(`gallery.sort.${key}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Opens and closes the filter panel; says how many filters are set. */
export function FilterToggle({ open, query, onToggle }: { open: boolean; query: GalleryQuery; onToggle: () => void }) {
  const t = useT()
  const count = activeFilterCount(query)
  return (
    <Button variant={open || count ? "secondary" : "ghost"} size="sm" aria-expanded={open} onClick={onToggle}>
      <SlidersHorizontal className="mr-1 h-4 w-4" />
      {count ? t("gallery.filter.buttonCount", { count }) : t("gallery.filter.button")}
    </Button>
  )
}

interface FilterPanelProps {
  open: boolean
  query: GalleryQuery
  onChange: (patch: Partial<GalleryQuery>) => void
  backends: string[]
  profiles: { id: string; label: string }[]
  /** The folder's models and LoRAs: all of them once read, else those seen so far. */
  facets: Facets
  /** While the folder is read for them. */
  facetsProgress: IndexProgress | null
  secret: boolean
}

/** Every filter but the search box, under the toolbar. */
export function FilterPanel({ open, query, onChange, backends, profiles, facets, facetsProgress, secret }: FilterPanelProps) {
  const t = useT()
  const toggleFormat = (format: Format) => {
    const current = query.formats ?? []
    onChange({ formats: current.includes(format) ? current.filter((item) => item !== format) : [...current, format] })
  }
  // A name filter (model, LoRA): a select of the names known so far, the
  // chosen one kept even when no loaded picture has it. In secret mode no
  // names go on the page, not even blurred.
  const nameField = (key: "model" | "lora", label: string, all: string, names: string[], note?: string) => {
    const chosen = query[key]
    const options = chosen && !names.includes(chosen) ? [chosen, ...names] : names
    return (
      <Field label={label} hint={secret ? undefined : t("gallery.filter.namesHint")} note={secret ? undefined : note}>
        {secret ? (
          <p className="flex h-8 items-center text-sm text-muted-foreground">{t("gallery.filter.secretHidden")}</p>
        ) : (
          <OptionSelect value={chosen} all={all} options={options.map((name) => ({ value: name, label: name }))} onChange={(name) => onChange({ [key]: name })} />
        )}
      </Field>
    )
  }
  const reading =
    facetsProgress && !("tooLarge" in facetsProgress)
      ? t("gallery.filter.namesReading", { done: facetsProgress.done, total: facetsProgress.total })
      : undefined

  return (
    <Collapsible open={open}>
      <CollapsibleContent>
        <div className="grid gap-x-6 gap-y-3 rounded-md border bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={t("gallery.filter.orientation")}>
            <div className="flex flex-wrap gap-1">
              {ORIENTATIONS.map((orientation) => (
                <ToggleChip
                  key={orientation}
                  pressed={query.orientation === orientation}
                  onClick={() => onChange({ orientation: query.orientation === orientation ? undefined : orientation })}
                >
                  {t(`gallery.filter.${orientation}`)}
                </ToggleChip>
              ))}
            </div>
          </Field>
          <Field label={t("gallery.filter.formats")}>
            <div className="flex flex-wrap gap-1">
              {FORMATS.map((format) => (
                <ToggleChip key={format} pressed={query.formats?.includes(format) ?? false} onClick={() => toggleFormat(format)}>
                  {format.toUpperCase()}
                </ToggleChip>
              ))}
            </div>
          </Field>
          <Field label={t("gallery.filter.since")}>
            <OptionSelect
              value={query.since}
              all={t("gallery.filter.anyTime")}
              options={SINCE.map((since) => ({ value: since, label: t(`gallery.filter.${since}`) }))}
              onChange={(since) => onChange({ since })}
            />
          </Field>
          <Field label={t("gallery.filter.resolution")}>
            <OptionSelect
              value={query.resolution}
              all={t("gallery.filter.anyResolution")}
              options={RESOLUTIONS.map((resolution) => ({ value: resolution, label: t(`gallery.filter.${resolution}`) }))}
              onChange={(resolution) => onChange({ resolution })}
            />
          </Field>
          {nameField("model", t("gallery.filter.model"), t("gallery.filter.allModels"), facets.models, reading)}
          {nameField("lora", t("gallery.filter.lora"), t("gallery.filter.allLoras"), facets.loras)}
          <Field label={t("gallery.filter.source")}>
            <OptionSelect
              value={query.source}
              all={t("gallery.filter.allSources")}
              options={SOURCES.map((source) => ({ value: source, label: t(`gallery.filter.${source}`) }))}
              onChange={(source) => onChange({ source })}
            />
          </Field>
          <Field label={t("gallery.backend")}>
            <OptionSelect
              value={query.backend}
              all={t("gallery.allBackends")}
              options={backends.map((id) => ({ value: id, label: id }))}
              onChange={(backend) => onChange({ backend })}
            />
          </Field>
          <Field label={t("gallery.filter.profileLabel")}>
            <OptionSelect
              value={query.profile}
              all={t("gallery.allProfiles")}
              options={profiles.map((profile) => ({ value: profile.id, label: profile.label }))}
              onChange={(profile) => onChange({ profile })}
            />
          </Field>
          <label className="flex items-center gap-2 self-end text-sm">
            <Switch checked={query.untagged ?? false} onCheckedChange={(checked) => onChange({ untagged: checked || undefined })} />
            {t("gallery.filter.untagged")}
          </label>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** The filters that are set, each with a ×, shown whether the panel is open or not. */
export function FilterChips({
  query,
  onChange,
  profiles,
  secret,
}: {
  query: GalleryQuery
  onChange: (patch: Partial<GalleryQuery>) => void
  profiles: { id: string; label: string }[]
  secret: boolean
}) {
  const t = useT()
  const chips: { key: string; label: string; clear: Partial<GalleryQuery> }[] = []
  const add = (key: string, label: string, clear: Partial<GalleryQuery>) => chips.push({ key, label, clear })

  if (query.orientation) add("orientation", t(`gallery.filter.${query.orientation}`), { orientation: undefined })
  const formats = query.formats ?? []
  if (formats.length && formats.length < FORMATS.length) add("formats", formats.map((format) => format.toUpperCase()).join(" / "), { formats: undefined })
  if (query.since) add("since", t(`gallery.filter.${query.since}`), { since: undefined })
  if (query.resolution) add("resolution", t(`gallery.filter.${query.resolution}`), { resolution: undefined })
  if (query.model) {
    add("model", `${t("gallery.filter.model")}: ${secret ? t("gallery.filter.secretHidden") : query.model}`, { model: undefined })
  }
  if (query.lora) {
    add("lora", `${t("gallery.filter.lora")}: ${secret ? t("gallery.filter.secretHidden") : query.lora}`, { lora: undefined })
  }
  if (query.source) add("source", `${t("gallery.filter.source")}: ${t(`gallery.filter.${query.source}`)}`, { source: undefined })
  if (query.backend) add("backend", `${t("gallery.backend")}: ${query.backend}`, { backend: undefined })
  if (query.profile) {
    const label = profiles.find((profile) => profile.id === query.profile)?.label ?? query.profile
    add("profile", `${t("gallery.filter.profileLabel")}: ${label}`, { profile: undefined })
  }
  if (query.untagged) add("untagged", t("gallery.filter.untaggedChip"), { untagged: undefined })

  if (chips.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <span key={chip.key} className="inline-flex h-6 items-center gap-1 rounded-full border bg-background pl-2.5 pr-1 text-xs">
          {chip.label}
          <button
            type="button"
            className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t("gallery.filter.remove", { name: chip.label })}
            title={t("gallery.filter.remove", { name: chip.label })}
            onClick={() => onChange(chip.clear)}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      {chips.length > 1 && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => onChange(Object.assign({}, ...chips.map((chip) => chip.clear)))}
        >
          {t("gallery.filter.clearAll")}
        </Button>
      )}
    </div>
  )
}

function Field({ label, hint, note, children }: { label: string; hint?: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground" title={hint}>
        {label}
      </Label>
      {children}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  )
}

function ToggleChip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button type="button" variant={pressed ? "default" : "outline"} size="sm" aria-pressed={pressed} onClick={onClick}>
      {children}
    </Button>
  )
}

/** A select whose first entry means "no filter". */
function OptionSelect<T extends string>({
  value,
  all,
  options,
  onChange,
}: {
  value: T | undefined
  all: string
  options: { value: T; label: string }[]
  onChange: (value: T | undefined) => void
}) {
  return (
    <Select value={value ?? ALL} onValueChange={(next) => onChange(next === ALL ? undefined : (next as T))}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{all}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
