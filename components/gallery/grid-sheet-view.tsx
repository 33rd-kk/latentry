"use client"

import { useEffect, useMemo } from "react"
import { Loader2 } from "lucide-react"
import { pictureUrl, type GalleryPage, type GalleryPicture } from "@/hooks/use-gallery"
import { layoutGrid } from "@/lib/gallery/grid-layout"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"

/**
 * An opened X/Y grid stack, as the grid was asked for: X values across, Y
 * values down, each cell's first picture (with how many it has), and the
 * sheet beside. The whole stack is loaded first: a grid has at most 128
 * pictures. Clicking one opens it in the viewer.
 */
export function GridSheetView({
  page,
  secret,
  onOpen,
}: {
  page: GalleryPage
  secret: boolean
  /** Opens the viewer at this picture's index in page.pictures. */
  onOpen: (index: number) => void
}) {
  const t = useT()
  const { hasMore, loading, loadMore, pictures } = page

  // Every page of the stack, one after another.
  useEffect(() => {
    if (hasMore && !loading) void loadMore()
  }, [hasMore, loading, loadMore])

  const layout = useMemo(
    () =>
      layoutGrid(pictures, (picture: GalleryPicture) => ({
        grid: picture.meta?.grid,
        sheet: picture.meta?.mode === "sheet",
        created: Date.parse(picture.meta?.created ?? "") || picture.mtime,
      })),
    [pictures]
  )
  const indexOf = useMemo(() => new Map(pictures.map((picture, index) => [picture, index])), [pictures])

  if (hasMore || loading) {
    return (
      <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("gallery.loading")}
      </p>
    )
  }
  if (!layout) return null

  const axisName = (kind: string) => t(`generate.grid.axis.${kind}` as "generate.grid.axis.cfg")
  const heading = layout.y
    ? t("generate.grid.heading", { x: axisName(layout.x.axis), y: axisName(layout.y.axis) })
    : t("generate.grid.headingOne", { x: axisName(layout.x.axis) })
  const yLabels = layout.y?.labels ?? [null]
  const columns = layout.x.labels.length

  const thumb = (picture: GalleryPicture, alt: string, count = 1) => (
    <button
      type="button"
      onClick={() => onOpen(indexOf.get(picture) ?? 0)}
      className="relative block h-full w-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      title={t("gallery.gridView.open")}
    >
      <img src={pictureUrl(picture, true)} alt={alt} loading="lazy" className={cn("h-full w-full object-cover", secret && "blur-xl")} />
      {count > 1 && <span className="absolute right-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">{count}</span>}
    </button>
  )

  return (
    <section className="space-y-3" aria-label={heading}>
      <p className="text-sm font-medium">{heading}</p>
      <div className="overflow-x-auto">
        <div
          className="grid gap-1.5 text-xs"
          style={{ gridTemplateColumns: `${layout.y ? "minmax(3rem, max-content) " : ""}repeat(${columns}, minmax(6rem, 1fr))` }}
          role="table"
          aria-label={heading}
        >
          <div role="row" className="contents">
            {layout.y && <span role="columnheader" />}
            {layout.x.labels.map((value, x) => (
              <span key={x} role="columnheader" className="truncate text-center text-muted-foreground" title={secret ? undefined : value}>
                {secret ? "•" : value || "?"}
              </span>
            ))}
          </div>
          {yLabels.map((yValue, y) => (
            <div role="row" key={y} className="contents">
              {layout.y && (
                <span role="rowheader" className="self-center truncate text-right text-muted-foreground" title={secret ? undefined : (yValue ?? "")}>
                  {secret ? "•" : yValue || "?"}
                </span>
              )}
              {layout.x.labels.map((xValue, x) => {
                const cell = layout.cells[y][x]
                const alt = t("generate.grid.cellAlt", { x: secret ? "" : xValue, y: secret ? "" : (yValue ?? "") })
                return (
                  <div role="cell" key={x} className="aspect-square overflow-hidden rounded-md border border-border/50 bg-muted/40">
                    {cell[0] ? (
                      thumb(cell[0], alt, cell.length)
                    ) : (
                      <span className="flex h-full items-center justify-center p-1 text-center text-muted-foreground">{t("gallery.gridView.missing")}</span>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
      {layout.sheets.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t("gallery.gridView.sheet")}</p>
          <div className="w-48 overflow-hidden rounded-md border border-border/50">{thumb(layout.sheets[0], t("gallery.gridView.sheet"))}</div>
        </div>
      )}
    </section>
  )
}
