"use client"

import { useId } from "react"
import { RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { TAG_STYLES } from "@/lib/tags"
import { BUILTIN, emptyProfile, PROFILE_FIELDS, type ChangeDraft, type Draft, type ProfileDraft } from "@/lib/settings/draft"
import type { SettingsView } from "@/lib/settings/view"
import { useT } from "@/lib/i18n"
import { Field, FieldError, Section } from "./section"

export function ProfilesSection({
  view,
  profiles,
  errors,
  change,
}: {
  view: SettingsView
  profiles: Draft["profiles"]
  errors: Record<string, string>
  change: ChangeDraft
}) {
  const t = useT()
  return (
    <Section title={t("settings.profilesTitle")} description={t("settings.profilesHint")} source={null}>
      <div className="space-y-4">
        {view.builtinProfiles.map((builtin) => (
          <ProfileCard key={builtin.id} builtin={builtin} fields={profiles[builtin.id]!} errors={errors} change={change} />
        ))}
      </div>
    </Section>
  )
}

function ProfileCard({
  builtin,
  fields,
  errors,
  change,
}: {
  builtin: SettingsView["builtinProfiles"][number]
  fields: ProfileDraft
  errors: Record<string, string>
  change: ChangeDraft
}) {
  const t = useT()
  const tagStyleId = useId()
  const set = (field: keyof ProfileDraft, value: string) =>
    change("profiles", (current) => ({ ...current, profiles: { ...current.profiles, [builtin.id]: { ...current.profiles[builtin.id]!, [field]: value } } }))
  const changed = PROFILE_FIELDS.some((field) => fields[field].trim())
  const at = (field: string) => `profiles.${builtin.id}.${field}`
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">
          {builtin.label}
          <span className="ml-2 text-xs font-normal text-muted-foreground">{t("settings.sizeMultiple", { multiple: builtin.sizeMultiple })}</span>
        </p>
        {changed && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              change("profiles", (current) => ({
                ...current,
                profiles: { ...current.profiles, [builtin.id]: emptyProfile() },
              }))
            }
          >
            <RotateCcw className="mr-1 h-3.5 w-3.5" />
            {t("settings.profileReset")}
          </Button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(["width", "height", "steps", "cfg"] as const).map((field) => (
          <Field key={field} label={t(`settings.profile.${field}`)}>
            <Input inputMode="decimal" value={fields[field]} placeholder={String(builtin[field])} onChange={(event) => set(field, event.target.value)} />
            <FieldError errors={errors} at={at(field)} />
          </Field>
        ))}
      </div>
      <Field label={t("settings.profile.negativePrompt")}>
        <Textarea rows={2} value={fields.negativePrompt} placeholder={builtin.negativePrompt} onChange={(event) => set("negativePrompt", event.target.value)} />
        <FieldError errors={errors} at={at("negativePrompt")} />
      </Field>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label={t("settings.profile.qualityTags")}>
          <Input value={fields.qualityTags} placeholder={builtin.qualityTags || t("settings.none")} onChange={(event) => set("qualityTags", event.target.value)} />
          <FieldError errors={errors} at={at("qualityTags")} />
        </Field>
        <Field label={t("settings.profile.artistTemplate")} hint={t("settings.artistTemplateHint")}>
          <Input value={fields.artistTemplate} placeholder={builtin.artistTemplate ?? "-"} onChange={(event) => set("artistTemplate", event.target.value)} />
          <FieldError errors={errors} at={at("artistTemplate")} />
        </Field>
        <Field label={t("settings.profile.tagStyle")} hint={t("settings.tagStyleHint")} htmlFor={tagStyleId}>
          <Select value={fields.tagStyle || BUILTIN} onValueChange={(value) => set("tagStyle", value === BUILTIN ? "" : value)}>
            <SelectTrigger id={tagStyleId} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={BUILTIN}>{t("settings.tagStyleBuiltin", { style: t(`settings.tagStyles.${builtin.tagStyle}`) })}</SelectItem>
              {TAG_STYLES.map((style) => (
                <SelectItem key={style} value={style}>
                  {t(`settings.tagStyles.${style}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError errors={errors} at={at("tagStyle")} />
        </Field>
        <Field label={t("settings.profile.keepTags")} hint={t("settings.keepTagsHint")}>
          <Input value={fields.keepTags} placeholder={builtin.keepTags || "-"} onChange={(event) => set("keepTags", event.target.value)} />
          <FieldError errors={errors} at={at("keepTags")} />
        </Field>
      </div>
    </div>
  )
}
