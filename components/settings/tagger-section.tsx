"use client"

import { CheckCircle2, XCircle } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AUTO, BUILTIN, type ChangeDraft, type Draft } from "@/lib/settings/draft"
import type { SettingsView } from "@/lib/settings/view"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"
import { Field, FieldError, Section } from "./section"

export function TaggerSection({
  view,
  draft,
  wd14Dirty,
  backendIds,
  errors,
  change,
  onUseEnv,
}: {
  view: SettingsView
  draft: Draft
  /** Whether the WD14 fields have unsaved changes, so the "found" line would be stale. */
  wd14Dirty: boolean
  backendIds: string[]
  errors: Record<string, string>
  change: ChangeDraft
  onUseEnv: () => void
}) {
  const t = useT()
  return (
    <Section
      title={t("settings.taggerTitle")}
      description={t("settings.taggerHint")}
      source={view.sources.wd14 === "settings" || view.sources.tagger === "settings" ? "settings" : "env"}
      onUseEnv={onUseEnv}
    >
      <div className="space-y-4">
        <div className="max-w-sm space-y-1">
          <Label>{t("settings.tagger")}</Label>
          <Select value={draft.tagger} onValueChange={(tagger) => change("tagger", (current) => ({ ...current, tagger }))}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO}>{t("settings.taggerAuto")}</SelectItem>
              <SelectItem value={BUILTIN}>{t("settings.taggerBuiltin")}</SelectItem>
              {backendIds.map((id) => (
                <SelectItem key={id} value={id}>
                  {t("settings.taggerBackend", { id })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError errors={errors} at="tagger" />
        </div>
        <Field label={t("settings.wd14Dir")} hint={t("settings.wd14DirHint")}>
          <Input
            value={draft.wd14Dir}
            onChange={(event) => change("wd14", (current) => ({ ...current, wd14Dir: event.target.value }))}
            placeholder={t("settings.wd14DirOff")}
            className="font-mono text-xs"
          />
          <FieldError errors={errors} at="wd14.modelDir" />
          {!wd14Dirty && view.wd14.modelDir && (
            <p className={cn("flex items-center gap-1 text-xs", view.wd14.found ? "text-emerald-600 dark:text-emerald-500" : "text-destructive")}>
              {view.wd14.found ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
              {t(view.wd14.found ? "settings.wd14Found" : "settings.wd14Missing")}
            </p>
          )}
        </Field>
        <div className="grid max-w-sm grid-cols-2 gap-2">
          {(["general", "character"] as const).map((field) => (
            <Field key={field} label={t(field === "general" ? "settings.wd14General" : "settings.wd14Character")}>
              <Input
                inputMode="decimal"
                value={field === "general" ? draft.wd14General : draft.wd14Character}
                placeholder={String(view.wd14.defaults[field])}
                onChange={(event) =>
                  change("wd14", (current) => ({ ...current, [field === "general" ? "wd14General" : "wd14Character"]: event.target.value }))
                }
              />
              <FieldError errors={errors} at={`wd14.${field}`} />
            </Field>
          ))}
        </div>
      </div>
    </Section>
  )
}
