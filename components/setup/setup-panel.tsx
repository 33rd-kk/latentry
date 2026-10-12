"use client"

import { Loader2 } from "lucide-react"
import { useEngineStatus } from "@/hooks/use-engine-status"
import { useT } from "@/lib/i18n"
import { EngineCard } from "./engine-card"
import { HardwareCard } from "./hardware-card"
import { ModelsCard } from "./models-card"
import { TaggerCard } from "./tagger-card"

export function SetupPanel() {
  const t = useT()
  const { status, ...actions } = useEngineStatus()

  if (!status) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("app.loading")}
      </div>
    )
  }
  if (!status.editable) {
    return <p className="text-sm text-muted-foreground">{t(status.reason === "off" ? "setup.readOnly" : "setup.notLocal")}</p>
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("setup.title")}</h1>
        <p className="text-sm break-all text-muted-foreground">{t("setup.intro", { dir: status.runtimeDir })}</p>
      </div>
      <HardwareCard status={status} />
      <EngineCard status={status} actions={actions} />
      <ModelsCard status={status} actions={actions} />
      <TaggerCard status={status} actions={actions} />
    </div>
  )
}
