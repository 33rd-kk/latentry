"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { EngineActions } from "@/hooks/use-engine-status"
import type { EngineStatus } from "@/lib/engine/status"
import { useT } from "@/lib/i18n"
import { CatalogItem } from "./catalog-item"

/** Face fix's detectors: each downloaded on request, after its license is shown. */
export function FaceDetectorCard({ status: s, actions }: { status: EngineStatus; actions: EngineActions }) {
  const t = useT()
  const { act } = actions
  const detectors = s.catalog.filter((entry) => entry.kind === "detector")
  return (
    <Card id="face-detectors">
      <CardHeader>
        <CardTitle>{t("setup.faceDetectors")}</CardTitle>
        <CardDescription>{t("setup.faceDetectorsBody")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {detectors.map((entry) => (
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
