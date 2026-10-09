"use client"

import { useRef } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { callsLora, insertLora, type FormState } from "@/lib/generate/form"
import type { EngineLora } from "@/hooks/use-engine-loras"
import { LoraPicker } from "./lora-picker"
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
  /** Whether the backend applies `<lora:…>` calls (A1111, Latentry's engine). */
  appliesLoras: boolean
  /** Latentry's engine: its LoRAs, to put a call into the prompt from a list. */
  loraPicker?: { loras: EngineLora[] | null; family: string | null; onOpen: () => void }
}

/** The words: artist (where the profile has a notation for one), prompt and negative prompt. */
export function PromptSection({ form, profile, update, promptScope, onPromptScopeChange, appliesLoras, loraPicker }: PromptSectionProps) {
  const t = useT()
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const pickLora = (name: string) => {
    const field = promptRef.current
    const { prompt, caret } = insertLora(form.prompt, name, field && document.activeElement === field ? field.selectionStart : undefined)
    update({ prompt })
    requestAnimationFrame(() => {
      promptRef.current?.focus()
      promptRef.current?.setSelectionRange(caret, caret)
    })
  }
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
          <div className="flex flex-wrap items-center justify-end gap-4">
            {loraPicker && <LoraPicker {...loraPicker} onPick={pickLora} />}
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
          ref={promptRef}
          {...PRIVATE_TEXT}
          rows={6}
          placeholder={t("generate.positivePlaceholder")}
          value={form.prompt}
          onChange={(event) => update({ prompt: event.target.value })}
        />
        {form.quality && profile.qualityTags && (
          <p className="text-xs text-muted-foreground">{t("generate.qualityTagsHint", { tags: profile.qualityTags })}</p>
        )}
        {!appliesLoras && callsLora(form.prompt) && (
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
