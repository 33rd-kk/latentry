"use client"

import { useState } from "react"
import { Download, ExternalLink } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import type { CatalogView } from "@/lib/engine/status"
import { useT } from "@/lib/i18n"
import { gb } from "./log-view"

/** One model or tagger offered for download: its license, and download or use it. */
export function CatalogItem({
  entry,
  canDownload,
  onDownload,
  onUse,
}: {
  entry: CatalogView
  canDownload: boolean
  onDownload: (entry: CatalogView) => void
  onUse?: (entry: CatalogView) => void
}) {
  const t = useT()
  const [accepted, setAccepted] = useState(false)
  const download = entry.download
  const busy = download?.state === "downloading" || download?.state === "queued" || download?.state === "verifying"
  const percent = download && download.totalBytes ? (download.doneBytes / download.totalBytes) * 100 : 0

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{entry.name}</span>
        {entry.recommended && <Badge variant="secondary">{t("setup.recommended")}</Badge>}
        {entry.inUse && <Badge>{t("setup.inUse")}</Badge>}
        <span className="ml-auto text-xs text-muted-foreground">{gb(entry.bytes)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span>{t("setup.license", { license: entry.license })}</span>
        <Badge variant={entry.commercialOutputs ? "outline" : "destructive"}>
          {t(entry.commercialOutputs ? "setup.commercialYes" : "setup.commercialNo")}
        </Badge>
        <a href={entry.licenseUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">
          {t("setup.readLicense")}
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      <p className="text-xs text-muted-foreground">{entry.terms}</p>

      {busy && download ? (
        <div className="space-y-1">
          <Progress value={percent} indeterminate={!download.totalBytes} />
          <p className="text-xs text-muted-foreground">
            {download.state === "verifying"
              ? t("setup.verifying")
              : t("setup.downloading", { done: gb(download.doneBytes), total: gb(download.totalBytes || entry.bytes) })}
          </p>
        </div>
      ) : entry.installed ? (
        <div className="flex items-center gap-2 text-xs">
          <Badge variant="outline">{t("setup.downloaded")}</Badge>
          {onUse && !entry.inUse && (
            <Button size="sm" variant="secondary" onClick={() => onUse(entry)}>
              {t("setup.use")}
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} className="h-4 w-4" />
            {t("setup.accept")}
          </label>
          <Button size="sm" disabled={!accepted || !canDownload} onClick={() => onDownload(entry)}>
            <Download className="mr-1.5 h-4 w-4" />
            {t("setup.download", { size: gb(entry.bytes) })}
          </Button>
        </div>
      )}
      {download?.state === "error" && <p className="text-xs text-destructive">{t("setup.downloadFailed", { error: download.error ?? "" })}</p>}
    </div>
  )
}
