"use client"

import { useId, useState } from "react"
import { BookMarked, ExternalLink, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useSecretMode } from "@/components/app-header"
import type { ModelInfoDraft, ModelInfoState } from "@/hooks/use-model-info"
import type { ModelInfo } from "@/lib/models/info"
import { PRIVATE_TEXT } from "@/lib/secret-mode"
import { useT, type MessageKey } from "@/lib/i18n"

interface ModelInfoCardProps {
  /** The model's file name, as the backend reports it. */
  name: string
  state: ModelInfoState
  /** The form's settings as info would keep them, for "Use current values". */
  current: () => ModelInfoDraft
  onApply: (info: ModelInfo) => void
  /** What the backend offers, suggested in the sampler and scheduler boxes. */
  samplers: string[]
  schedulers: string[]
  disabled?: boolean
}

/** The editor's boxes: text, so a half-typed number is not thrown away. */
interface Fields {
  url: string
  notes: string
  sampler: string
  scheduler: string
  steps: string
  cfg: string
  width: string
  height: string
  negativePrompt: string
  hires: ModelInfo["hires"] | null
}

const text = (value: number | string | undefined) => (value === undefined ? "" : String(value))

function toFields(info: ModelInfoDraft | null): Fields {
  return {
    url: text(info?.url),
    notes: text(info?.notes),
    sampler: text(info?.sampler),
    scheduler: text(info?.scheduler),
    steps: text(info?.steps),
    cfg: text(info?.cfg),
    width: text(info?.width),
    height: text(info?.height),
    negativePrompt: text(info?.negativePrompt),
    hires: info?.hires ?? null,
  }
}

function toDraft(fields: Fields): ModelInfoDraft {
  // An empty box is left out; a number box that is not a number goes as typed, for the server to refuse by name.
  const number = (value: string) => (value.trim() === "" ? undefined : Number.isFinite(Number(value)) ? Number(value) : value)
  const optional = (value: string) => (value.trim() === "" ? undefined : value)
  return {
    url: optional(fields.url.trim()),
    notes: optional(fields.notes),
    sampler: optional(fields.sampler),
    scheduler: optional(fields.scheduler),
    steps: number(fields.steps),
    cfg: number(fields.cfg),
    width: number(fields.width),
    height: number(fields.height),
    negativePrompt: optional(fields.negativePrompt),
    ...(fields.hires ? { hires: fields.hires } : {}),
  } as ModelInfoDraft
}

/** The link's site, for a short label; the whole link is in its title. */
function siteOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/**
 * What the user keeps about the selected model: where it came from and the
 * settings its page recommends. Applying puts them on the form; switching
 * models never does. Kept on this computer, never fetched from the link.
 */
export function ModelInfoCard({ name, state, current, onApply, samplers, schedulers, disabled }: ModelInfoCardProps) {
  const t = useT()
  const id = useId()
  const secret = useSecretMode()
  const [editing, setEditing] = useState<Fields | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [failed, setFailed] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { info } = state

  const startEdit = () => {
    setEditing(toFields(info))
    setErrors({})
    setFailed(null)
  }
  const set = (patch: Partial<Fields>) => setEditing((fields) => (fields ? { ...fields, ...patch } : fields))
  const useCurrent = () => {
    const values = current()
    set({ ...toFields({ ...values }), url: editing?.url ?? "", notes: editing?.notes ?? "" })
  }
  const save = async () => {
    if (!editing) return
    setBusy(true)
    const result = await state.save(toDraft(editing))
    setBusy(false)
    if (!result) {
      setEditing(null)
      return
    }
    setErrors(result.errors ?? {})
    setFailed(result.errors ? null : t.server(result.error))
  }
  const remove = async () => {
    setBusy(true)
    const error = await state.remove()
    setBusy(false)
    if (error) setFailed(t.server(error))
    else setEditing(null)
  }

  const summary = info
    ? [
        info.sampler,
        info.scheduler,
        info.steps !== undefined ? t("modelInfo.summarySteps", { value: info.steps }) : null,
        info.cfg !== undefined ? t("modelInfo.summaryCfg", { value: info.cfg }) : null,
        info.width && info.height ? `${info.width}×${info.height}` : null,
        info.hires ? t("modelInfo.summaryHires", { value: info.hires.scale }) : null,
      ].filter(Boolean)
    : []

  const field = (key: keyof Fields, label: string, input: React.ReactNode) => (
    <div className="space-y-1">
      <Label htmlFor={`${id}-${key}`} className="text-xs">
        {label}
      </Label>
      {input}
      {errors[key] && <p className="text-xs text-destructive">{t(errors[key] as MessageKey)}</p>}
    </div>
  )

  if (editing) {
    return (
      <div className="space-y-2 rounded-md border p-2" aria-label={t("modelInfo.editTitle", { name })} role="group">
        <p className="truncate text-xs font-medium" title={name}>
          {t("modelInfo.editTitle", { name })}
        </p>
        {field(
          "url",
          t("modelInfo.url"),
          <Input
            {...PRIVATE_TEXT}
            id={`${id}-url`}
            type="url"
            inputMode="url"
            value={editing.url}
            onChange={(event) => set({ url: event.target.value })}
            placeholder="https://"
            className="h-8 text-xs"
          />
        )}
        <div className="grid grid-cols-2 gap-2">
          {field(
            "sampler",
            t("generate.sampler"),
            <Input {...PRIVATE_TEXT} id={`${id}-sampler`} list={`${id}-samplers`} value={editing.sampler} onChange={(event) => set({ sampler: event.target.value })} className="h-8 text-xs" />
          )}
          {field(
            "scheduler",
            t("generate.scheduler"),
            <Input {...PRIVATE_TEXT} id={`${id}-scheduler`} list={`${id}-schedulers`} value={editing.scheduler} onChange={(event) => set({ scheduler: event.target.value })} className="h-8 text-xs" />
          )}
          {field(
            "steps",
            t("modelInfo.steps"),
            <Input id={`${id}-steps`} inputMode="numeric" value={editing.steps} onChange={(event) => set({ steps: event.target.value })} className="h-8 text-xs" />
          )}
          {field(
            "cfg",
            t("modelInfo.cfg"),
            <Input id={`${id}-cfg`} inputMode="decimal" value={editing.cfg} onChange={(event) => set({ cfg: event.target.value })} className="h-8 text-xs" />
          )}
          {field(
            "width",
            t("modelInfo.width"),
            <Input id={`${id}-width`} inputMode="numeric" value={editing.width} onChange={(event) => set({ width: event.target.value })} className="h-8 text-xs" />
          )}
          {field(
            "height",
            t("modelInfo.height"),
            <Input id={`${id}-height`} inputMode="numeric" value={editing.height} onChange={(event) => set({ height: event.target.value })} className="h-8 text-xs" />
          )}
        </div>
        <datalist id={`${id}-samplers`}>
          {samplers.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
        <datalist id={`${id}-schedulers`}>
          {schedulers.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
        {field(
          "negativePrompt",
          t("generate.negativePrompt"),
          <Textarea {...PRIVATE_TEXT} id={`${id}-negativePrompt`} rows={2} value={editing.negativePrompt} onChange={(event) => set({ negativePrompt: event.target.value })} className="text-xs" />
        )}
        {field(
          "notes",
          t("modelInfo.notes"),
          <Textarea {...PRIVATE_TEXT} id={`${id}-notes`} rows={2} value={editing.notes} onChange={(event) => set({ notes: event.target.value })} className="text-xs" />
        )}
        {editing.hires && (
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {t("modelInfo.hiresKept", {
                scale: editing.hires.scale,
                denoise: editing.hires.denoise,
                upscaler: editing.hires.upscaler,
              })}
            </span>
            <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => set({ hires: null })}>
              {t("modelInfo.hiresDrop")}
            </Button>
          </div>
        )}
        {errors.hires && <p className="text-xs text-destructive">{t(errors.hires as MessageKey)}</p>}
        <p className="text-xs text-muted-foreground">{secret ? t("modelInfo.secretHint") : t("modelInfo.hint")}</p>
        {failed && <p className="text-xs text-destructive">{failed}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" size="sm" variant="outline" className="mr-auto h-7 text-xs" onClick={useCurrent} disabled={busy}>
            {t("modelInfo.useCurrent")}
          </Button>
          {info && (
            <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void remove()} disabled={busy}>
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              {t("modelInfo.delete")}
            </Button>
          )}
          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(null)} disabled={busy}>
            {t("generate.cancel")}
          </Button>
          <Button type="button" size="sm" className="h-7 text-xs" onClick={() => void save()} disabled={busy}>
            {t("modelInfo.save")}
          </Button>
        </div>
      </div>
    )
  }

  if (!info) {
    return (
      <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" onClick={startEdit} disabled={disabled}>
        <BookMarked className="mr-1 h-3.5 w-3.5" />
        {t("modelInfo.add")}
      </Button>
    )
  }

  return (
    <div className="space-y-1.5 rounded-md border p-2 text-xs" role="group" aria-label={t("modelInfo.title")}>
      <div className="flex items-center gap-2">
        <BookMarked className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{summary.length ? summary.join(" · ") : t("modelInfo.title")}</span>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={startEdit}
          disabled={disabled}
          aria-label={t("modelInfo.edit")}
          title={t("modelInfo.edit")}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={() => onApply(info)} disabled={disabled}>
          {t("modelInfo.apply")}
        </Button>
      </div>
      {info.url && (
        // Opened only when clicked, and without telling the site where the click came from.
        <a href={info.url} target="_blank" rel="noopener noreferrer" title={info.url} className="flex items-center gap-1 underline underline-offset-2">
          <ExternalLink className="h-3 w-3 shrink-0" />
          <span className="truncate">{siteOf(info.url)}</span>
        </a>
      )}
      {info.notes && <p className="line-clamp-3 whitespace-pre-line text-muted-foreground">{info.notes}</p>}
    </div>
  )
}
