"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Cpu, Images, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useT } from "@/lib/i18n"

const EXAMPLE = `# .env.local
GEN_BACKENDS=anima|diffusers|http://localhost:7865|anima;sdxl|a1111|http://localhost:7860|illustrious
GEN_TOKEN_SDXL=user:password
GALLERY_SAVE_DIR=./output`

/**
 * What the notice offers besides the setup help (read on the server by the page):
 *
 * - On a fresh install (no mode chosen on Settings or by LATENTRY_MODE):
 *   `choose` asks how Latentry is used, when this client may change settings;
 *   `askOwner` says an owner device can choose; `readOnly` says no one can
 *   (SETTINGS_EDIT=off: only LATENTRY_MODE sets it).
 * - Once generating was chosen: `switch` offers browsing only instead, when
 *   this client may change settings and LATENTRY_MODE does not decide.
 * - Null: the setup help alone.
 */
export type FirstRun = "choose" | "askOwner" | "readOnly" | "switch" | null

/** Shown instead of the form while there is no backend. */
export function SetupNotice({ firstRun = null }: { firstRun?: FirstRun }) {
  const [chosen, setChosen] = useState(false)
  if (firstRun === "choose" && !chosen) return <FirstRunChoice onGenerate={() => setChosen(true)} />
  return (
    <GenerateSetup
      note={firstRun === "askOwner" || firstRun === "readOnly" ? firstRun : null}
      offerBrowse={firstRun === "switch" || firstRun === "choose"}
    />
  )
}

/** Saves the mode; browsing only then goes on to the gallery folders. */
function useSaveMode() {
  const t = useT()
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  async function save(mode: "gallery" | "full", stopRuns = false): Promise<boolean> {
    setSaving(true)
    try {
      const response = await fetch(stopRuns ? "/api/settings?stopRuns=1" : "/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        // Runs going (one started from another tab): asked first, as on Settings.
        if (response.status === 409 && typeof data?.runs === "number" && !stopRuns) {
          if (window.confirm(t.server(data.error))) return save(mode, true)
          setSaving(false)
          return false
        }
        throw new Error(typeof data?.error === "string" ? t.server(data.error) : String(response.status))
      }
      if (mode === "gallery") router.push("/settings#gallery")
      else setSaving(false)
      return true
    } catch (error) {
      toast.error(t("app.firstRun.failed"), { description: error instanceof Error ? error.message : undefined })
      setSaving(false)
      return false
    }
  }
  return { save, saving }
}

/**
 * The engine's setup first, then bringing your own backend; below, when
 * `offerBrowse`, the way to browsing only for whoever changes their mind.
 */
function GenerateSetup({ note, offerBrowse }: { note: "askOwner" | "readOnly" | null; offerBrowse: boolean }) {
  const t = useT()
  const { save, saving } = useSaveMode()
  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle>{t("app.setupTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {note && <p className="text-muted-foreground">{t(`app.firstRun.${note}`)}</p>}
        <p>{t("app.setupEngine")}</p>
        <Button asChild>
          <Link href="/setup">
            <Cpu className="mr-1.5 h-4 w-4" />
            {t("app.setupEngineButton")}
          </Link>
        </Button>
        <p className="pt-2">{t("app.setupBody")}</p>
        <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">{EXAMPLE}</pre>
        <p className="text-muted-foreground">{t("app.setupRestart")}</p>
        {offerBrowse && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t pt-3">
            <p className="text-muted-foreground">{t("app.firstRun.switchText")}</p>
            <Button variant="outline" size="sm" onClick={() => void save("gallery")} disabled={saving}>
              <Images className="mr-1.5 h-4 w-4" aria-hidden />
              {t("app.firstRun.switchButton")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Browse only, or generate too. Either answer is saved as the mode (Settings
 * > Mode), so the question is asked once; browsing then goes on to
 * the gallery folders.
 */
function FirstRunChoice({ onGenerate }: { onGenerate: () => void }) {
  const t = useT()
  const { save, saving } = useSaveMode()

  async function choose(mode: "gallery" | "full") {
    if ((await save(mode)) && mode === "full") onGenerate()
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">{t("app.firstRun.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("app.firstRun.description")}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Images className="h-4 w-4" aria-hidden />
              {t("app.firstRun.browseTitle")}
            </CardTitle>
            <CardDescription>{t("app.firstRun.browseBody")}</CardDescription>
          </CardHeader>
          <CardContent className="mt-auto space-y-3 text-sm">
            <p className="text-muted-foreground">{t("app.firstRun.browseDocker")}</p>
            <Button onClick={() => void choose("gallery")} disabled={saving}>
              {t("app.firstRun.browseButton")}
            </Button>
          </CardContent>
        </Card>
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" aria-hidden />
              {t("app.firstRun.generateTitle")}
            </CardTitle>
            <CardDescription>{t("app.firstRun.generateBody")}</CardDescription>
          </CardHeader>
          <CardContent className="mt-auto text-sm">
            <Button variant="outline" onClick={() => void choose("full")} disabled={saving}>
              {t("app.firstRun.generateButton")}
            </Button>
          </CardContent>
        </Card>
      </div>
      <p className="text-xs text-muted-foreground">{t("app.firstRun.later")}</p>
    </div>
  )
}
