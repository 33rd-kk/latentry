"use client"

import { Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { EngineActions } from "@/hooks/use-engine-status"
import type { EngineStatus } from "@/lib/engine/status"
import { useT } from "@/lib/i18n"
import { CatalogItem } from "./catalog-item"
import { HfDownload } from "./hf-download"
import { gb } from "./log-view"
import { ModelsFolder } from "./models-folder"

/** The models folder, the models in it (load one), a file to download by URL, and the checkpoints to download. */
export function ModelsCard({ status: s, actions }: { status: EngineStatus; actions: EngineActions }) {
  const t = useT()
  const { pending, refresh, act } = actions
  const engineUp = s.engines.some((engine) => engine.state === "running")
  const checkpoints = s.catalog.filter((entry) => entry.kind === "checkpoint")
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("setup.models")}</CardTitle>
        <CardDescription className="break-all">{t("setup.modelsBody", { dir: s.modelsDir })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {s.installed && <ModelsFolder status={s} onSaved={refresh} />}
        {/* Downloads go through the engine, so say why Download stays off without one. */}
        {!engineUp && <p className="text-muted-foreground">{t(s.installed ? "setup.needEngine" : "setup.needInstall")}</p>}
        {s.models && (
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground uppercase">{t("setup.inFolder")}</h3>
            {s.models.length === 0 && <p className="text-muted-foreground">{t("setup.emptyFolder")}</p>}
            {s.models.map((model) => {
              const loading = s.engines.some((engine) => engine.loading === model.id)
              return (
                <div key={model.id} className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
                  <span className="font-medium">{model.name}</span>
                  {model.family && <Badge variant="outline">{model.family.toUpperCase()}</Badge>}
                  <span className="text-xs text-muted-foreground">{gb(model.sizeBytes)}</span>
                  <span className="ml-auto">
                    {!model.family ? (
                      <span className="text-xs text-muted-foreground">{t("setup.unsupported")}</span>
                    ) : s.current === model.id ? (
                      <Badge>{t("setup.loaded")}</Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={loading || pending !== null}
                        onClick={() => void act(`load:${model.id}`, "/api/engine/models/load", { id: model.id })}
                      >
                        {loading && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                        {t("setup.load")}
                      </Button>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        )}
        {s.installed && <HfDownload status={s} actions={actions} canDownload={engineUp} />}
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground uppercase">{t("setup.available")}</h3>
          {checkpoints.map((entry) => (
            <CatalogItem
              key={entry.id}
              entry={entry}
              canDownload={engineUp}
              onDownload={(item) => void act(`download:${item.id}`, "/api/engine/models/download", { id: item.id })}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
