"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { callsLora, type FormState } from "@/lib/generate/form"
import type { BackendKind } from "@/lib/backends/types"
import type { Profile } from "@/lib/profiles"
import { PRIVATE_TEXT } from "@/lib/secret-mode"
import type { PromptScope } from "@/lib/storage"
import { useT } from "@/lib/i18n"

interface PromptSectionProps {
  form: FormState
  profile: Profile
  update: (patch: Partial<FormState>) => void
  promptScope: PromptScope
  onPromptScopeChange: (scope: PromptScope) => void
  /** Which kind of backend the prompt goes to: only A1111 loads `<lora:…>`. */
  backendKind: BackendKind
}

/** The words: artist (where the profile has a notation for one), prompt and negative prompt. */
export function PromptSection({ form, profile, update, promptScope, onPromptScopeChange, backendKind }: PromptSectionProps) {
  const t = useT()
  return (
    <>
      {profile.artistTemplate && (
        <div className="space-y-1.5">
          <Label htmlFor="artist">{t("generate.artist")}</Label>
          <Input
            id="artist"
            {...PRIVATE_TEXT}
            placeholder={t("generate.artistPlaceholder", { example: profile.artistTemplate.replace("{artist}", "name") })}
            value={form.artist}
            onChange={(event) => update({ artist: event.target.value })}
          />
        </div>
      )}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="prompt">{t("generate.positivePrompt")}</Label>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs text-muted-foreground" title={t("generate.sharedPromptHint")}>
              <Switch
                checked={promptScope === "shared"}
                onCheckedChange={(shared) => onPromptScopeChange(shared ? "shared" : "backend")}
              />
              {t("generate.sharedPrompt")}
            </label>
            {profile.qualityTags && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground" title={profile.qualityTags}>
                <Switch checked={form.quality} onCheckedChange={(quality) => update({ quality })} />
                {t("generate.qualityTags")}
              </label>
            )}
          </div>
        </div>
        <Textarea
          id="prompt"
          {...PRIVATE_TEXT}
          rows={6}
          placeholder={t("generate.positivePlaceholder")}
          value={form.prompt}
          onChange={(event) => update({ prompt: event.target.value })}
        />
        {form.quality && profile.qualityTags && (
          <p className="text-xs text-muted-foreground">{t("generate.qualityTagsHint", { tags: profile.qualityTags })}</p>
        )}
        {backendKind !== "a1111" && callsLora(form.prompt) && (
          <p className="text-xs text-amber-600 dark:text-amber-500">{t("generate.loraIgnored")}</p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="negative-prompt">{t("generate.negativePrompt")}</Label>
        <Textarea
          id="negative-prompt"
          {...PRIVATE_TEXT}
          rows={3}
          value={form.negativePrompt}
          onChange={(event) => update({ negativePrompt: event.target.value })}
        />
      </div>
    </>
  )
}
