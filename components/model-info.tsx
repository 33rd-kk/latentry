"use client"

// Model info's editor and its short view, shared by the generate page (the
// selected model) and Settings (every model kept).

import { useId, useState, type ReactNode } from "react"
import { ExternalLink, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useSecretMode } from "@/components/app-header"
import type { ModelInfoDraft, ModelInfoFailure } from "@/lib/models/client"
import type { ModelInfo } from "@/lib/models/info"
import { PRIVATE_TEXT } from "@/lib/secret-mode"
import { useT, type MessageKey, type Translator } from "@/lib/i18n"

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

/** "Euler a · Karras · 28 steps · CFG 5 · 832×1216": what the info recommends, in one line. */
export function modelInfoSummary(info: ModelInfo, t: Translator): string {
  return [
    info.sampler,
    info.scheduler,
    info.steps !== undefined ? t("modelInfo.summarySteps", { value: info.steps }) : null,
    info.cfg !== undefined ? t("modelInfo.summaryCfg", { value: info.cfg }) : null,
    info.width && info.height ? `${info.width}×${info.height}` : null,
    info.hires ? t("modelInfo.summaryHires", { value: info.hires.scale }) : null,
  ]
    .filter(Boolean)
    .join(" · ")
}

/** The info's link and notes, under its summary. */
export function ModelInfoDetails({ info }: { info: ModelInfo }) {
  return (
    <>
      {info.url && (
        // Opened only when clicked, and without telling the site where the click came from.
        <a href={info.url} target="_blank" rel="noopener noreferrer" title={info.url} className="flex w-fit max-w-full items-center gap-1 underline underline-offset-2">
          <ExternalLink className="h-3 w-3 shrink-0" />
          <span className="truncate">{siteOf(info.url)}</span>
        </a>
      )}
      {info.notes && <p className="line-clamp-3 whitespace-pre-line text-muted-foreground">{info.notes}</p>}
    </>
  )
}

interface ModelInfoEditorProps {
  /** The model's file name. */
  name: string
  info: ModelInfo | null
  onSave: (draft: ModelInfoDraft) => Promise<ModelInfoFailure | null>
  /** Shown when there is info to delete. */
  onDelete?: () => Promise<string | null>
  onDone: () => void
  /** The form's settings as info would keep them, for "Use current values"; only on the generate page. */
  current?: () => ModelInfoDraft
  /** Suggested in the sampler and scheduler boxes. */
  samplers?: string[]
  schedulers?: string[]
}

export function ModelInfoEditor({ name, info, onSave, onDelete, onDone, current, samplers = [], schedulers = [] }: ModelInfoEditorProps) {
  const t = useT()
  const id = useId()
  const secret = useSecretMode()
  const [fields, setFields] = useState<Fields>(() => toFields(info))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [failed, setFailed] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const set = (patch: Partial<Fields>) => setFields((previous) => ({ ...previous, ...patch }))
  const useCurrent = () => {
    if (current) set({ ...toFields(current()), url: fields.url, notes: fields.notes })
  }
  const save = async () => {
    setBusy(true)
    const result = await onSave(toDraft(fields))
    setBusy(false)
    if (!result) return onDone()
    setErrors(result.errors ?? {})
    setFailed(result.errors ? null : t.server(result.error))
  }
  const remove = async () => {
    if (!onDelete) return
    setBusy(true)
    const error = await onDelete()
    setBusy(false)
    if (error) setFailed(t.server(error))
    else onDone()
  }

  const field = (key: keyof Fields, label: string, input: ReactNode) => (
    <div className="space-y-1">
      <Label htmlFor={`${id}-${key}`} className="text-xs">
        {label}
      </Label>
      {input}
      {errors[key] && <p className="text-xs text-destructive">{t(errors[key] as MessageKey)}</p>}
    </div>
  )
  const box = (key: "sampler" | "scheduler" | "steps" | "cfg" | "width" | "height", label: string, extra: Record<string, string> = {}) =>
    field(key, label, <Input {...PRIVATE_TEXT} {...extra} id={`${id}-${key}`} value={fields[key]} onChange={(event) => set({ [key]: event.target.value })} className="h-8 text-xs" />)

  return (
    <div className="space-y-2 rounded-md border p-2" aria-label={t("modelInfo.editTitle", { name })} role="group">
      <p className="truncate text-xs font-medium" title={name}>
        {t("modelInfo.editTitle", { name })}
      </p>
      {field(
        "url",
        t("modelInfo.url"),
        <Input {...PRIVATE_TEXT} id={`${id}-url`} type="url" inputMode="url" value={fields.url} onChange={(event) => set({ url: event.target.value })} placeholder="https://" className="h-8 text-xs" />
      )}
      <div className="grid grid-cols-2 gap-2">
        {box("sampler", t("generate.sampler"), { list: `${id}-samplers` })}
        {box("scheduler", t("generate.scheduler"), { list: `${id}-schedulers` })}
        {box("steps", t("modelInfo.steps"), { inputMode: "numeric" })}
        {box("cfg", t("modelInfo.cfg"), { inputMode: "decimal" })}
        {box("width", t("modelInfo.width"), { inputMode: "numeric" })}
        {box("height", t("modelInfo.height"), { inputMode: "numeric" })}
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
        <Textarea {...PRIVATE_TEXT} id={`${id}-negativePrompt`} rows={2} value={fields.negativePrompt} onChange={(event) => set({ negativePrompt: event.target.value })} className="text-xs" />
      )}
      {field(
        "notes",
        t("modelInfo.notes"),
        <Textarea {...PRIVATE_TEXT} id={`${id}-notes`} rows={2} value={fields.notes} onChange={(event) => set({ notes: event.target.value })} className="text-xs" />
      )}
      {fields.hires && (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{t("modelInfo.hiresKept", { scale: fields.hires.scale, denoise: fields.hires.denoise, upscaler: fields.hires.upscaler })}</span>
          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => set({ hires: null })}>
            {t("modelInfo.hiresDrop")}
          </Button>
        </div>
      )}
      {errors.hires && <p className="text-xs text-destructive">{t(errors.hires as MessageKey)}</p>}
      <p className="text-xs text-muted-foreground">{secret ? t("modelInfo.secretHint") : t("modelInfo.hint")}</p>
      {failed && <p className="text-xs text-destructive">{failed}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        {current && (
          <Button type="button" size="sm" variant="outline" className="mr-auto h-7 text-xs" onClick={useCurrent} disabled={busy}>
            {t("modelInfo.useCurrent")}
          </Button>
        )}
        {info && onDelete && (
          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void remove()} disabled={busy}>
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            {t("modelInfo.delete")}
          </Button>
        )}
        <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={onDone} disabled={busy}>
          {t("generate.cancel")}
        </Button>
        <Button type="button" size="sm" className="h-7 text-xs" onClick={() => void save()} disabled={busy}>
          {t("modelInfo.save")}
        </Button>
      </div>
    </div>
  )
}
