"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { EngineActions } from "@/hooks/use-engine-status"
import type { EngineStatus } from "@/lib/engine/status"
import { useT } from "@/lib/i18n"
import { CatalogItem } from "./catalog-item"

/** The models that make control pictures (depth, line art): each downloaded on request, after its license is shown. */
export function ControlModelsCard({ status: s, actions }: { status: EngineStatus; actions: EngineActions }) {
  const t = useT()
  const { act } = actions
  const annotators = s.catalog.filter((entry) => entry.kind === "annotator")
  return (
    <Card id="control-models">
      <CardHeader>
        <CardTitle>{t("setup.controlModels")}</CardTitle>
        <CardDescription>{t("setup.controlModelsBody")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {annotators.map((entry) => (
          <CatalogItem
            key={entry.id}
            entry={entry}
            canDownload
            onDownload={(item) => void act(`download:${item.id}`, "/api/engine/models/download", { id: item.id })}
          />
        ))}
      </CardContent>
    </Card>
  )
}
