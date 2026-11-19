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
 * On a fresh install (no backend, and no mode chosen on Settings or by
 * LATENTRY_MODE), whether to ask how Latentry is used: `choose` when this
 * client may change settings, `askOwner` when it may not. Null otherwise:
 * then the notice is the usual setup help.
 */
export type FirstRun = "choose" | "askOwner" | null

/** Shown instead of the form while there is no backend. */
export function SetupNotice({ firstRun = null }: { firstRun?: FirstRun }) {
  const [chosen, setChosen] = useState(false)
  if (firstRun === "choose" && !chosen) return <FirstRunChoice onGenerate={() => setChosen(true)} />
  return <GenerateSetup askOwner={firstRun === "askOwner"} />
}

/** The engine's setup first, then bringing your own backend. */
function GenerateSetup({ askOwner }: { askOwner: boolean }) {
  const t = useT()
  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle>{t("app.setupTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {askOwner && <p className="text-muted-foreground">{t("app.firstRun.askOwner")}</p>}
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
      </CardContent>
    </Card>
  )
}

/**
 * Browse only, or generate too. Either answer is saved as the mode (Settings
 * > How you use it), so the question is asked once; browsing then goes on to
 * the gallery folders.
 */
function FirstRunChoice({ onGenerate }: { onGenerate: () => void }) {
  const t = useT()
  const router = useRouter()
  const [saving, setSaving] = useState(false)

  async function choose(mode: "gallery" | "full") {
    setSaving(true)
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(typeof data?.error === "string" ? t.server(data.error) : String(response.status))
      }
      if (mode === "gallery") router.push("/settings#gallery")
      else onGenerate()
    } catch (error) {
      toast.error(t("app.firstRun.failed"), { description: error instanceof Error ? error.message : undefined })
      setSaving(false)
    }
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
