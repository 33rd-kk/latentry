"use client"

import { useState } from "react"
import { BookMarked, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ModelInfoDetails, ModelInfoEditor, modelInfoSummary } from "@/components/model-info"
import type { ModelInfoDraft, ModelInfoState } from "@/hooks/use-model-info"
import type { ModelInfo } from "@/lib/models/info"
import { useT } from "@/lib/i18n"

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

/**
 * What the user keeps about the selected model: where it came from and the
 * settings its page recommends. Applying puts them on the form; switching
 * models never does. Kept on this computer, never fetched from the link.
 * Every model's is listed on Settings, for the ones not loaded.
 */
export function ModelInfoCard({ name, state, current, onApply, samplers, schedulers, disabled }: ModelInfoCardProps) {
  const t = useT()
  const [editing, setEditing] = useState(false)
  const { info } = state

  if (editing) {
    return (
      <ModelInfoEditor
        name={name}
        info={info}
        onSave={state.save}
        onDelete={state.remove}
        onDone={() => setEditing(false)}
        current={current}
        samplers={samplers}
        schedulers={schedulers}
      />
    )
  }

  if (!info) {
    return (
      <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => setEditing(true)} disabled={disabled}>
        <BookMarked className="mr-1 h-3.5 w-3.5" />
        {t("modelInfo.add")}
      </Button>
    )
  }

  const summary = modelInfoSummary(info, t)
  return (
    <div className="space-y-1.5 rounded-md border p-2 text-xs" role="group" aria-label={t("modelInfo.title")}>
      <div className="flex items-center gap-2">
        <BookMarked className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{summary || t("modelInfo.title")}</span>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={() => setEditing(true)}
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
      <ModelInfoDetails info={info} />
    </div>
  )
}
