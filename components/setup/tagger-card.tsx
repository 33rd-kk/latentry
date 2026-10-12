"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { EngineActions } from "@/hooks/use-engine-status"
import type { EngineStatus } from "@/lib/engine/status"
import { useT } from "@/lib/i18n"
import { CatalogItem } from "./catalog-item"

/** The built-in tagger's models: download one, or choose which to use. */
export function TaggerCard({ status: s, actions }: { status: EngineStatus; actions: EngineActions }) {
  const t = useT()
  const { act, chooseTagger } = actions
  const taggers = s.catalog.filter((entry) => entry.kind === "tagger")
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("setup.tagger")}</CardTitle>
        <CardDescription>{t("setup.taggerBody")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {taggers.map((entry) => (
          <CatalogItem
            key={entry.id}
            entry={entry}
            canDownload
            onDownload={(item) => void act(`download:${item.id}`, "/api/engine/models/download", { id: item.id })}
            onUse={(item) => void chooseTagger(item)}
          />
        ))}
      </CardContent>
    </Card>
  )
}
