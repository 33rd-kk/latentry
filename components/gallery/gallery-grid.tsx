"use client"

import { useEffect, useMemo, useRef } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { GalleryCard } from "./gallery-card"
import { useColumnCount } from "@/hooks/use-column-count"
import type { GalleryPage } from "@/hooks/use-gallery"
import type { GallerySelection } from "@/hooks/use-gallery-selection"
import { exactTagQuery } from "@/lib/gallery/query"
import type { GalleryQuery } from "@/lib/gallery/filter"
import { dealColumns, heightPerWidth } from "@/lib/gallery/columns"
import { useT } from "@/lib/i18n"

/**
 * The cards in columns, the next page loaded as the end scrolls into view,
 * and what to say while loading or when nothing is there.
 */
export function GalleryGrid({
  page,
  secret,
  showTags,
  selection,
  onOpen,
  onChange,
  onSearchText,
}: {
  page: GalleryPage
  secret: boolean
  showTags: boolean
  selection: GallerySelection
  onOpen: (index: number) => void
  onChange: (patch: Partial<GalleryQuery>) => void
  onSearchText: (text: string) => void
}) {
  const t = useT()
  const sentinel = useRef<HTMLDivElement>(null)
  const columnCount = useColumnCount()
  // Dealt in order to the shortest column (lib/gallery/columns.ts), so a new
  // page only adds to the bottoms. Tags under the cards add roughly a third
  // of a column's width.
  const columns = useMemo(
    () =>
      dealColumns(
        page.pictures.map((picture) => heightPerWidth(picture.width, picture.height) + (showTags ? 0.3 : 0.02)),
        columnCount
      ),
    [page.pictures, columnCount, showTags]
  )

  // The next page loads as the end of the grid scrolls into view.
  useEffect(() => {
    const node = sentinel.current
    if (!node || !page.hasMore) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void page.loadMore()
      },
      { rootMargin: "800px" }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [page])

  const { selecting, selected, toggleSelected } = selection
  return (
    <>
      <div className="flex items-start gap-3">
        {columns.map((indices, column) => (
          <div key={column} className="min-w-0 flex-1">
            {indices.map((index) => {
              const picture = page.pictures[index]
              return (
                <GalleryCard
                  key={`${picture.dir}/${picture.name}`}
                  picture={picture}
                  secret={secret}
                  showTags={showTags}
                  selecting={selecting}
                  selected={selected.has(picture.name)}
                  onOpen={() => onOpen(index)}
                  onToggleSelect={() => toggleSelected(picture.name)}
                  onOpenStack={picture.stack ? () => onChange({ stack: picture.stack!.key }) : undefined}
                  onSearchTag={(tag) => onSearchText(exactTagQuery(tag))}
                />
              )
            })}
          </div>
        ))}
      </div>
      <div ref={sentinel} className="h-8" />

      {page.loading && (
        <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("gallery.loading")}
        </p>
      )}
      {!page.loading && page.pictures.length === 0 && !page.error && !page.indexing && (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {page.hasMore ? t("gallery.keepSearching") : t("gallery.empty")}
        </p>
      )}
      {!page.loading && page.hasMore && page.pictures.length === 0 && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => void page.loadMore()}>
            {t("gallery.searchFurther")}
          </Button>
        </div>
      )}
      {page.error && <p className="text-sm text-destructive">{page.error}</p>}
    </>
  )
}
