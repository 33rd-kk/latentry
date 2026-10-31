"use client"

import { useCallback, useSyncExternalStore } from "react"
import { Loader2, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useLocalText } from "@/hooks/use-local-text"
import { useSettingsForm } from "@/hooks/use-settings-form"
import type { Part } from "@/lib/settings/draft"
import { useT } from "@/lib/i18n"
import { OwnerCodeSteps } from "@/components/owner-code-steps"
import { ThisDeviceCard } from "@/components/this-device"
import { BackendsSection } from "./backends-section"
import { GallerySection } from "./gallery-section"
import { ModelsSection } from "./models-section"
import { PairingCard } from "./pairing-card"
import { ProfilesSection } from "./profiles-section"
import { TaggerSection } from "./tagger-section"
import { WildcardsSection } from "./wildcards-section"

// The page's sections, in the order the list shows them, and the parts of the
// draft each one edits. A link can open one: /settings#gallery.
const SECTIONS = ["backends", "tagger", "gallery", "profiles", "models", "wildcards", "devices"] as const
type SectionId = (typeof SECTIONS)[number]
const SECTION_PARTS: Record<SectionId, readonly Part[]> = {
  backends: ["backends"],
  tagger: ["tagger", "wd14"],
  gallery: ["gallery"],
  profiles: ["profiles"],
  // Saved at once, apart from the draft.
  models: [],
  wildcards: ["wildcards"],
  devices: [],
}
const isSection = (id: string): id is SectionId => (SECTIONS as readonly string[]).includes(id)

const subscribeHash = (listener: () => void) => {
  window.addEventListener("hashchange", listener)
  return () => window.removeEventListener("hashchange", listener)
}

/** The section shown: the link's, else the one last chosen in this browser. */
function useSection(): [SectionId, (id: SectionId) => void] {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash.slice(1), () => "")
  const [stored, setStored] = useLocalText("latentry:settings-section", SECTIONS[0])
  const section = isSection(hash) ? hash : isSection(stored) ? stored : SECTIONS[0]
  const choose = useCallback(
    (id: SectionId) => {
      // Replaced, not pushed: Back leaves the page rather than walking its
      // sections. The hash is read again as the stored choice re-renders.
      window.history.replaceState(window.history.state, "", `#${id}`)
      setStored(id)
    },
    [setStored]
  )
  return [section, choose]
}

export function SettingsForm() {
  const t = useT()
  const { view, draft, dirty, errors, saving, backendIds, load, change, save } = useSettingsForm()
  const [section, chooseSection] = useSection()

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
          {view.reason === "notLocal" && (
            <CardContent>
              <OwnerCodeSteps />
            </CardContent>
          )}
        </Card>
        <PairingCard />
        <ThisDeviceCard />
      </div>
    )
  }

  if (!draft) return null

  // A part is unsaved, or the server refused a field in it (errors are keyed
  // by path, the part first).
  const marked = (id: SectionId) => {
    const parts = SECTION_PARTS[id]
    return {
      unsaved: parts.some((part) => dirty.has(part)),
      invalid: Object.keys(errors).some((at) => parts.includes(at.split(".")[0] as Part)),
    }
  }

  return (
    <div className="mx-auto max-w-5xl pb-24">
      <div>
        <h1 className="text-2xl font-semibold">{t("settings.title")}</h1>
        <p className="mt-1 text-xs text-muted-foreground">{t("settings.version", { version: view.version })}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t("settings.intro", { file: view.file })}</p>
      </div>

      {/* One section at a time, chosen on the left (above, on a phone). */}
      <Tabs value={section} onValueChange={(id) => chooseSection(id as SectionId)} orientation="vertical" className="mt-6 flex-col gap-6 md:flex-row">
        <TabsList
          variant="line"
          aria-label={t("settings.nav.label")}
          className="w-full flex-wrap items-start justify-start group-data-vertical/tabs:flex-row md:sticky md:top-20 md:w-44 md:shrink-0 md:self-start md:group-data-vertical/tabs:flex-col"
        >
          {SECTIONS.map((id) => {
            const { unsaved, invalid } = marked(id)
            return (
              <TabsTrigger key={id} value={id} className="flex-none justify-start px-2 py-1.5 group-data-vertical/tabs:w-auto md:group-data-vertical/tabs:w-full">
                {t(`settings.nav.${id}`)}
                {invalid ? (
                  <span className="ml-auto h-2 w-2 rounded-full bg-destructive" role="img" aria-label={t("settings.nav.invalid")} />
                ) : unsaved ? (
                  <span className="ml-auto h-2 w-2 rounded-full bg-primary" role="img" aria-label={t("settings.unsaved")} />
                ) : null}
              </TabsTrigger>
            )
          })}
        </TabsList>

        <div className="min-w-0 flex-1">
          <TabsContent value="backends">
            <BackendsSection view={view} backends={draft.backends} errors={errors} change={change} onUseEnv={() => void save({ backends: null })} />
          </TabsContent>
          <TabsContent value="tagger">
            <TaggerSection
              view={view}
              draft={draft}
              wd14Dirty={dirty.has("wd14")}
              backendIds={backendIds}
              errors={errors}
              change={change}
              onUseEnv={() => void save({ wd14: null, tagger: null })}
            />
          </TabsContent>
          <TabsContent value="gallery">
            <GallerySection view={view} draft={draft} errors={errors} change={change} onUseEnv={() => void save({ gallery: null })} />
          </TabsContent>
          <TabsContent value="profiles">
            <ProfilesSection view={view} profiles={draft.profiles} errors={errors} change={change} />
          </TabsContent>
          <TabsContent value="models">
            <ModelsSection />
          </TabsContent>
          <TabsContent value="wildcards">
            <WildcardsSection draft={draft} errors={errors} change={change} />
          </TabsContent>
          {/* ── Phones and other computers ── */}
          <TabsContent value="devices">
            <PairingCard />
          </TabsContent>
        </div>
      </Tabs>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-end gap-2 px-4 py-3">
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
