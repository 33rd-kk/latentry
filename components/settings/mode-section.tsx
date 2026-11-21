"use client"

import { useRouter } from "next/navigation"
import { Switch } from "@/components/ui/switch"
import type { SettingsView } from "@/lib/settings/view"
import { useT } from "@/lib/i18n"
import { Section } from "./section"

/**
 * Gallery-only mode (lib/mode.ts). Saved the moment it is switched, so it
 * waits while other changes are unsaved: saving it reloads the whole form.
 * LATENTRY_MODE, when set, decides instead and the switch only shows it.
 */
export function ModeSection({
  view,
  unsaved,
  saving,
  save,
}: {
  view: SettingsView
  unsaved: boolean
  saving: boolean
  save: (override: Record<string, unknown>, options?: { stopRuns?: boolean }) => Promise<{ runsGoing: string } | void>
}) {
  const t = useT()
  const router = useRouter()
  const { env, inEffect } = view.mode
  const on = inEffect === "gallery"

  const turn = async (galleryOnly: boolean) => {
    const mode = { mode: galleryOnly ? "gallery" : "full" }
    // Runs going: the server asks first, since nothing can stop them afterwards.
    const asked = await save(mode)
    if (asked && !window.confirm(asked.runsGoing)) return
    if (asked) await save(mode, { stopRuns: true })
    // The header and the other pages read the mode on the server.
    router.refresh()
  }

  return (
    <Section title={t("settings.mode.title")} description={t("settings.mode.description")} source={env ? "env" : null}>
      <div className="space-y-3 text-sm">
        <label className="flex items-center gap-2">
          <Switch id="mode" checked={on} disabled={env !== null || unsaved || saving} onCheckedChange={(checked) => void turn(checked)} />
          {t("settings.mode.galleryOnly")}
        </label>
        {env !== null && <p className="text-xs text-muted-foreground">{t("settings.mode.fromEnv", { mode: env })}</p>}
        {env === null && unsaved && <p className="text-xs text-muted-foreground">{t("settings.mode.saveFirst")}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <p className="text-xs font-medium">{t("settings.mode.keeps")}</p>
            <p className="text-xs text-muted-foreground">{t("settings.mode.keepsList")}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium">{t("settings.mode.stops")}</p>
            <p className="text-xs text-muted-foreground">{t("settings.mode.stopsList")}</p>
          </div>
        </div>
      </div>
    </Section>
  )
}
