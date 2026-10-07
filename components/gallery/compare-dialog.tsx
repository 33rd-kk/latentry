"use client"

import { useMemo, useState } from "react"
import { Eye } from "lucide-react"
import { ReactCompareSlider, ReactCompareSliderImage } from "react-compare-slider"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { pictureUrl, type GalleryPicture } from "@/hooks/use-gallery"
import { sameShape, settingRows, tagDiff, type SettingKey } from "@/lib/gallery/compare"
import type { MessageKey } from "@/lib/i18n/core"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const SETTING_LABELS: Record<SettingKey, MessageKey> = {
  model: "gallery.model",
  loras: "gallery.loras",
  seed: "gallery.seed",
  steps: "gallery.steps",
  cfg: "gallery.cfg",
  sampler: "gallery.sampler",
  strength: "gallery.strength",
  size: "gallery.size",
}

interface CompareDialogProps {
  /** The two pictures, or null when closed. */
  pair: [GalleryPicture, GalleryPicture] | null
  onClose: () => void
  secret: boolean
}

/**
 * Two pictures side by side: one sliding over the other when they have the
 * same shape, next to each other when not; then the settings that differ
 * and the prompt tags only one of them has.
 */
export function CompareDialog({ pair, onClose, secret }: CompareDialogProps) {
  const t = useT()
  // Secret mode hides the pictures and what describes them until "Show",
  // which lasts for this pair while the dialog is open.
  const pairKey = pair ? `${pair[0].dir}/${pair[0].name}|${pair[1].dir}/${pair[1].name}` : ""
  const [shownFor, setShownFor] = useState<string | null>(null)
  const hidden = secret && shownFor !== pairKey

  const details = useMemo(() => {
    if (!pair) return null
    const [a, b] = pair
    return { rows: settingRows(a, b), tags: tagDiff(a.meta?.prompt, b.meta?.prompt), slide: sameShape(a, b) }
  }, [pair])

  const close = () => {
    setShownFor(null)
    onClose()
  }

  return (
    <Dialog open={pair !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{t("gallery.compare.title")}</DialogTitle>
        </DialogHeader>
        {pair && details && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <span className="truncate" title={pair[0].name}>
                A · {pair[0].name}
              </span>
              <span className="truncate" title={pair[1].name}>
                B · {pair[1].name}
              </span>
            </div>
            {details.slide ? (
              <div className="mx-auto max-h-[60vh] overflow-hidden rounded-md" style={{ aspectRatio: `${pair[0].width} / ${pair[0].height}` }}>
                <ReactCompareSlider
                  className="h-full w-full"
                  itemOne={<ReactCompareSliderImage src={pictureUrl(pair[0])} alt="A" className={cn(hidden && "blur-xl")} />}
                  itemTwo={<ReactCompareSliderImage src={pictureUrl(pair[1])} alt="B" className={cn(hidden && "blur-xl")} />}
                />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {pair.map((picture, index) => (
                  <img
                    key={index}
                    src={pictureUrl(picture)}
                    alt={index === 0 ? "A" : "B"}
                    className={cn("max-h-[60vh] w-full rounded-md object-contain", hidden && "blur-xl")}
                  />
                ))}
              </div>
            )}

            {hidden ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>{t("gallery.compare.secretHidden")}</span>
                <button type="button" className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline" onClick={() => setShownFor(pairKey)}>
                  <Eye className="h-3.5 w-3.5" />
                  {t("gallery.compare.secretReveal")}
                </button>
              </div>
            ) : (
              <>
                {details.rows.length > 0 && (
                  <table className="w-full table-fixed text-xs">
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        <th className="w-28 py-1 font-normal" />
                        <th className="py-1 font-normal">A</th>
                        <th className="py-1 font-normal">B</th>
                      </tr>
                    </thead>
                    <tbody>
                      {details.rows.map((row) => (
                        <tr key={row.key} className={cn("border-t", row.differs && "bg-amber-500/10 font-medium")}>
                          <th className="py-1 pr-2 text-left font-normal text-muted-foreground">{t(SETTING_LABELS[row.key])}</th>
                          <td className="break-words py-1 pr-2">{row.a || "—"}</td>
                          <td className="break-words py-1">{row.b || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  {(["onlyA", "onlyB"] as const).map((side) => (
                    <div key={side} className="space-y-1.5">
                      <p className="text-xs text-muted-foreground">{t(side === "onlyA" ? "gallery.compare.onlyA" : "gallery.compare.onlyB", { count: details.tags[side].length })}</p>
                      <div className="flex flex-wrap gap-1">
                        {details.tags[side].map((tag) => (
                          <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-xs">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{t("gallery.compare.shared", { count: details.tags.shared })}</p>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
