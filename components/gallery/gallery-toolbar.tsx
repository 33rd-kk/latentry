"use client"

import { CheckSquare, FolderOpen, Lock, RefreshCw, Search, Tags } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PRIVATE_TEXT } from "@/lib/secret-mode"
import { FilterToggle, SortSelect } from "./gallery-filters"
import { SearchHintToggle } from "./search-hint"
import type { GalleryFolder, GalleryPage } from "@/hooks/use-gallery"
import type { GallerySelection } from "@/hooks/use-gallery-selection"
import type { GalleryQuery } from "@/lib/gallery/filter"
import { DEFAULT_SORT } from "@/lib/gallery/sort"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"

/** The row above the grid: folder tabs, search, order, filters and the view toggles. */
export function GalleryToolbar({
  folders,
  activeDir,
  onDir,
  searchText,
  onSearchText,
  onSearchFocus,
  query,
  onChange,
  filtersOpen,
  onToggleFilters,
  page,
  showTags,
  onShowTags,
  selection,
}: {
  folders: GalleryFolder[] | null
  activeDir: number | null
  onDir: (dir: number) => void
  searchText: string
  onSearchText: (text: string) => void
  onSearchFocus: (focused: boolean) => void
  query: GalleryQuery
  onChange: (patch: Partial<GalleryQuery>) => void
  filtersOpen: boolean
  onToggleFilters: () => void
  page: GalleryPage
  showTags: boolean
  onShowTags: (show: boolean) => void
  selection: GallerySelection
}) {
  const t = useT()
  const { selecting, setSelecting, setSelected, bulk } = selection
  return (
    <div className="flex flex-wrap items-center gap-2">
      {folders && folders.length > 1 && (
        <Tabs value={String(activeDir)} onValueChange={(value) => onDir(Number(value))}>
          <TabsList>
            {folders.map((option) => (
              <TabsTrigger key={option.index} value={String(option.index)} className="gap-1">
                {option.writable ? <FolderOpen className="h-3.5 w-3.5" /> : <Lock className="h-3 w-3" />}
                {option.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}
      <div className="relative min-w-48 flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          {...PRIVATE_TEXT}
          value={searchText}
          onChange={(event) => onSearchText(event.target.value)}
          onFocus={() => onSearchFocus(true)}
          onBlur={() => onSearchFocus(false)}
          placeholder={t("gallery.search")}
          className="pl-8"
        />
      </div>
      <SearchHintToggle />
      <SortSelect value={query.sort ?? DEFAULT_SORT} onChange={(sort) => onChange({ sort })} />
      <FilterToggle open={filtersOpen} query={query} onToggle={onToggleFilters} />
      <Button variant="ghost" size="icon" onClick={page.reload} aria-label={t("gallery.refresh")} title={t("gallery.refresh")}>
        <RefreshCw className={cn("h-4 w-4", page.loading && "animate-spin")} />
      </Button>
      <Button variant={showTags ? "secondary" : "ghost"} size="sm" aria-pressed={showTags} onClick={() => onShowTags(!showTags)}>
        <Tags className="mr-1 h-4 w-4" />
        {t("gallery.showTags")}
      </Button>
      <Button
        variant={selecting ? "secondary" : "ghost"}
        size="sm"
        aria-pressed={selecting}
        onClick={() => {
          setSelecting(!selecting)
          if (selecting) setSelected(new Set())
        }}
        disabled={bulk.running}
      >
        <CheckSquare className="mr-1 h-4 w-4" />
        {t("gallery.select")}
      </Button>
    </div>
  )
}
