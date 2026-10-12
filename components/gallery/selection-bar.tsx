"use client"

import { Columns2, Tags, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
import type { GalleryFolder, GalleryPicture } from "@/hooks/use-gallery"
import type { GallerySelection } from "@/hooks/use-gallery-selection"
import { useT } from "@/lib/i18n"

/**
 * While selecting, or while a bulk tagging run is on screen: how many are
 * selected, quick ways to select, comparing two, and tagging them all.
 */
export function SelectionBar({
  selection,
  pictures,
  folder,
  canTag,
  onCompare,
}: {
  selection: GallerySelection
  pictures: GalleryPicture[]
  folder: GalleryFolder | null
  canTag: boolean
  onCompare: (pair: [GalleryPicture, GalleryPicture]) => void
}) {
  const t = useT()
  const { selecting, selected, setSelected, skipTagged, setSkipTagged, bulk, runBulkTag } = selection
  if (!selecting && !bulk.progress) return null
  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{t("gallery.selectedCount", { count: selected.size })}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={bulk.running || pictures.length === 0}
          onClick={() => setSelected(new Set(pictures.map((picture) => picture.name)))}
        >
          {t("gallery.selectAll", { count: pictures.length })}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={bulk.running || pictures.length === 0}
          onClick={() => setSelected(new Set(pictures.filter((picture) => !picture.meta?.tags?.length).map((picture) => picture.name)))}
        >
          {t("gallery.selectUntagged")}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={bulk.running || selected.size === 0} onClick={() => setSelected(new Set())}>
          {t("gallery.selectNone")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={selected.size !== 2}
          title={t("gallery.compare.buttonHint")}
          onClick={() => {
            const two = pictures.filter((picture) => selected.has(picture.name))
            if (two.length === 2) onCompare([two[0], two[1]])
          }}
        >
          <Columns2 className="mr-1 h-4 w-4" />
          {t("gallery.compare.button")}
        </Button>
        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={skipTagged} onCheckedChange={setSkipTagged} disabled={bulk.running} />
          {t("gallery.skipTagged")}
        </label>
        {bulk.running ? (
          <Button type="button" variant="destructive" size="sm" onClick={bulk.cancel}>
            {t("gallery.bulkCancel")}
          </Button>
        ) : (
          <Button type="button" size="sm" disabled={selected.size === 0 || !folder?.writable || !canTag} onClick={() => void runBulkTag()}>
            <Tags className="mr-1 h-4 w-4" />
            {t("gallery.bulkTag", { count: selected.size })}
          </Button>
        )}
      </div>
      {selecting && folder && !folder.writable && <p className="text-xs text-muted-foreground">{t("gallery.bulkReadOnly")}</p>}
      {selecting && !canTag && <p className="text-xs text-muted-foreground">{t("gallery.bulkNoTagger")}</p>}
      {bulk.progress && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {t("gallery.bulkProgress", {
                done: bulk.progress.done,
                total: bulk.progress.total,
                tagged: bulk.progress.tagged,
                skipped: bulk.progress.skipped,
                failed: bulk.progress.failed,
              })}
            </span>
            {!bulk.running && (
              <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={bulk.reset}>
                <X className="h-3 w-3" />
                {t("gallery.bulkDismiss")}
              </button>
            )}
          </div>
          <Progress value={(bulk.progress.done / Math.max(1, bulk.progress.total)) * 100} indeterminate={bulk.running && bulk.progress.done === 0} />
          {bulk.progress.errors.map((failure) => (
            <p key={failure.name} className="truncate text-xs text-destructive" title={failure.error}>
              {failure.name}: {failure.error}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
