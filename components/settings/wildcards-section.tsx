"use client"

import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import type { ChangeDraft, Draft } from "@/lib/settings/draft"
import { useT } from "@/lib/i18n"
import { Field, FieldError, Section } from "./section"

/** The wildcards folder, and whether paired devices may use it. Settings only: there is no .env.local value. */
export function WildcardsSection({ draft, errors, change }: { draft: Draft; errors: Record<string, string>; change: ChangeDraft }) {
  const t = useT()
  return (
    <Section title={t("settings.wildcardsTitle")} description={t("settings.wildcardsHint")} source={null}>
      <div className="space-y-4">
        <Field label={t("settings.wildcardsDir")} hint={t("settings.wildcardsDirHint")}>
          <Input
            value={draft.wildcardsDir}
            onChange={(event) => change("wildcards", (current) => ({ ...current, wildcardsDir: event.target.value }))}
            placeholder={t("settings.wildcardsDirOff")}
            aria-label={t("settings.wildcardsDir")}
            className="font-mono text-xs"
          />
          <FieldError errors={errors} at="wildcards.dir" />
        </Field>
        <div className="space-y-1">
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={draft.wildcardsShare}
              onCheckedChange={(wildcardsShare) => change("wildcards", (current) => ({ ...current, wildcardsShare }))}
            />
            {t("settings.wildcardsShare")}
          </label>
          <p className="text-xs text-muted-foreground">{t("settings.wildcardsShareHint")}</p>
        </div>
      </div>
    </Section>
  )
}
