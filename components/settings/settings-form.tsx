"use client"

import { Loader2, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useSettingsForm } from "@/hooks/use-settings-form"
import { useT } from "@/lib/i18n"
import { ThisDeviceCard } from "@/components/this-device"
import { BackendsSection } from "./backends-section"
import { GallerySection } from "./gallery-section"
import { PairingCard } from "./pairing-card"
import { ProfilesSection } from "./profiles-section"
import { TaggerSection } from "./tagger-section"

export function SettingsForm() {
  const t = useT()
  const { view, draft, dirty, errors, saving, backendIds, load, change, save } = useSettingsForm()

  if (view === null) {
    return (
      <p className="flex items-center gap-2 py-24 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("app.loading")}
      </p>
    )
  }

  if (!view.editable) {
    // Pairing is managed on this machine even where SETTINGS_EDIT=off; the
    // card hides itself everywhere else.
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("settings.title")}</CardTitle>
            <CardDescription>{t(view.reason === "off" ? "settings.lockedOff" : "settings.lockedRemote")}</CardDescription>
          </CardHeader>
        </Card>
        <PairingCard />
        <ThisDeviceCard />
      </div>
    )
  }

  if (!draft) return null

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-24">
      <div>
        <h1 className="text-2xl font-semibold">{t("settings.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("settings.intro", { file: view.file })}</p>
      </div>

      <BackendsSection view={view} backends={draft.backends} errors={errors} change={change} onUseEnv={() => void save({ backends: null })} />
      <TaggerSection
        view={view}
        draft={draft}
        wd14Dirty={dirty.has("wd14")}
        backendIds={backendIds}
        errors={errors}
        change={change}
        onUseEnv={() => void save({ wd14: null, tagger: null })}
      />
      <GallerySection view={view} draft={draft} errors={errors} change={change} onUseEnv={() => void save({ gallery: null })} />
      <ProfilesSection view={view} profiles={draft.profiles} errors={errors} change={change} />

      {/* ── Phones and other computers ── */}
      <PairingCard />

      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-end gap-2 px-4 py-3">
          {dirty.size > 0 && <span className="mr-auto text-xs text-muted-foreground">{t("settings.unsaved")}</span>}
          <Button type="button" variant="ghost" onClick={() => void load()} disabled={saving || dirty.size === 0}>
            {t("settings.discard")}
          </Button>
          <Button type="button" onClick={() => void save()} disabled={saving || dirty.size === 0}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
            {t("settings.save")}
          </Button>
        </div>
      </div>
    </div>
  )
}
