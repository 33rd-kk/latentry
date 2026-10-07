"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { toast } from "sonner"
import { CheckSquare, FolderOpen, Loader2, Lock, RefreshCw, Search, Tags, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ImageLightbox, type LightboxItem } from "@/components/ui/image-lightbox"
import { useSecretMode } from "@/components/app-header"
import { GalleryCard } from "./gallery-card"
import { GalleryPanel } from "./gallery-panel"
import { FilterChips, FilterPanel, FilterToggle, SortSelect } from "./gallery-filters"
import { SearchHint, SearchHintToggle } from "./search-hint"
import { useBackends } from "@/hooks/use-backends"
import { useBulkTag } from "@/hooks/use-bulk-tag"
import { pictureUrl, useGalleryFolders, useGalleryPage, type GalleryPicture } from "@/hooks/use-gallery"
import { useLocalFlag } from "@/hooks/use-local-flag"
import type { ImageTag } from "@/lib/gallery/png-meta"
import { listProfiles } from "@/lib/profiles"
import { exactTagQuery } from "@/lib/gallery/query"
import { toParams, type GalleryQuery } from "@/lib/gallery/filter"
import { DEFAULT_SORT } from "@/lib/gallery/sort"
import { dealColumns, heightPerWidth } from "@/lib/gallery/columns"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"

/**
 * The pictures in the configured folders, newest first unless another order
 * is chosen: the save folder (written with every setting) and any read-only
 * folders of other tools.
 */
export function Gallery() {
  const t = useT()
  const secret = useSecretMode()
  const folders = useGalleryFolders()
  const { backends, tagger } = useBackends()
  const [dir, setDir] = useState<number | null>(null)
  const [searchText, setSearchText] = useState("")
  const [searchFocused, setSearchFocused] = useState(false)
  const [q, setQ] = useState("")
  // The order and filters live only as long as the page: nothing about what
  // was looked for is kept in the browser or the address bar.
  const [filters, setFilters] = useState<Omit<GalleryQuery, "q">>({})
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [viewing, setViewing] = useState<number | null>(null)
  const sentinel = useRef<HTMLDivElement>(null)

  const activeDir = dir ?? folders?.[0]?.index ?? null
  const folder = folders?.find((candidate) => candidate.index === activeDir) ?? null
  const query = useMemo<GalleryQuery>(() => ({ ...filters, q }), [filters, q])
  const changeFilters = useCallback((patch: Partial<GalleryQuery>) => setFilters((current) => ({ ...current, ...patch })), [])
  const page = useGalleryPage(activeDir, query)
  const profiles = useMemo(() => listProfiles().map(({ id, label }) => ({ id, label })), [])

  // The models met so far in this folder, for the model filter. Kept while
  // filters change, so choosing a model does not shrink the list to it.
  const pageModels = useMemo(() => modelsIn(page.pictures), [page.pictures])
  const [seenModels, setSeenModels] = useState<{ dir: number | null; models: string[] }>({ dir: activeDir, models: [] })
  const models = seenModels.dir === activeDir ? mergeModels(seenModels.models, pageModels) : pageModels
  if (seenModels.dir !== activeDir || models.length !== seenModels.models.length) setSeenModels({ dir: activeDir, models })

  // Tags under each card, on or off for every card at once, remembered here.
  const [showTags, setShowTags] = useLocalFlag("latentry:gallery-show-tags", false)
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
  const [skipTagged, setSkipTagged] = useLocalFlag("latentry:bulk-skip-tagged", true)

  // Selection for bulk tagging, by file name within the folder on screen.
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const selectionKey = `${activeDir}|${toParams(query)}`
  const [selectionFor, setSelectionFor] = useState(selectionKey)
  if (selectionFor !== selectionKey) {
    // Another folder or another search: the old selection names other pictures.
    setSelectionFor(selectionKey)
    setSelected(new Set())
  }
  const toggleSelected = useCallback((name: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }, [])

  // Each finished picture shows its tags at once, without reloading the folder.
  const picturesRef = useRef<GalleryPicture[]>([])
  useEffect(() => {
    picturesRef.current = page.pictures
  }, [page.pictures])
  const { patch } = page
  const onTagged = useCallback(
    (name: string, tags: ImageTag[]) => {
      const picture = picturesRef.current.find((item) => item.name === name)
      if (picture) patch(picture, { ...(picture.meta ?? { source: "unknown", prompt: "", negativePrompt: "" }), tags })
    },
    [patch]
  )
  const bulk = useBulkTag(onTagged)

  const runBulkTag = useCallback(async () => {
    if (activeDir === null || selected.size === 0) return
    const names = page.pictures.filter((picture) => selected.has(picture.name)).map((picture) => picture.name)
    const result = await bulk.start(activeDir, names, skipTagged)
    if (!result.ok) toast.error(t("gallery.bulkFailed"), { description: result.error })
    else if (result.cancelled) toast(t("gallery.bulkCancelled"))
  }, [activeDir, selected, page.pictures, bulk, skipTagged, t])

  // The search applies after typing pauses, not on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setQ(searchText.trim()), 300)
    return () => clearTimeout(timer)
  }, [searchText])

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

  const items = useMemo<LightboxItem[]>(
    () => page.pictures.map((picture) => ({ src: pictureUrl(picture), name: picture.name, downloadName: picture.name })),
    [page.pictures]
  )

  if (folders && folders.length === 0) {
    return (
      <Card className="mx-auto max-w-2xl">
        <CardHeader>
          <CardTitle>{t("gallery.notConfiguredTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>{t("gallery.notConfigured")}</p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
            {"GALLERY_SAVE_DIR=./output\nGALLERY_DIRS=D:\\ComfyUI\\output;E:\\webui\\outputs\\txt2img-images"}
          </pre>
        </CardContent>
      </Card>
    )
  }

  const viewed = viewing !== null ? page.pictures[viewing] : null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {folders && folders.length > 1 && (
          <Tabs value={String(activeDir)} onValueChange={(value) => setDir(Number(value))}>
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
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder={t("gallery.search")}
            className="pl-8"
          />
        </div>
        <SearchHintToggle />
        <SortSelect value={filters.sort ?? DEFAULT_SORT} onChange={(sort) => changeFilters({ sort })} />
        <FilterToggle open={filtersOpen} query={query} onToggle={() => setFiltersOpen(!filtersOpen)} />
        <Button variant="ghost" size="icon" onClick={page.reload} aria-label={t("gallery.refresh")} title={t("gallery.refresh")}>
          <RefreshCw className={cn("h-4 w-4", page.loading && "animate-spin")} />
        </Button>
        <Button variant={showTags ? "secondary" : "ghost"} size="sm" aria-pressed={showTags} onClick={() => setShowTags(!showTags)}>
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
      <SearchHint visible={searchFocused || searchText.trim().length > 0} />
      <FilterPanel
        open={filtersOpen}
        query={query}
        onChange={changeFilters}
        backends={backends.map((option) => option.id)}
        profiles={profiles}
        models={models}
        secret={secret}
      />
      <FilterChips query={query} onChange={changeFilters} profiles={profiles} secret={secret} />

      {(selecting || bulk.progress) && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{t("gallery.selectedCount", { count: selected.size })}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={bulk.running || page.pictures.length === 0}
              onClick={() => setSelected(new Set(page.pictures.map((picture) => picture.name)))}
            >
              {t("gallery.selectAll", { count: page.pictures.length })}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={bulk.running || page.pictures.length === 0}
              onClick={() => setSelected(new Set(page.pictures.filter((picture) => !picture.meta?.tags?.length).map((picture) => picture.name)))}
            >
              {t("gallery.selectUntagged")}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={bulk.running || selected.size === 0} onClick={() => setSelected(new Set())}>
              {t("gallery.selectNone")}
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
              <Button
                type="button"
                size="sm"
                disabled={selected.size === 0 || !folder?.writable || tagger === null}
                onClick={() => void runBulkTag()}
              >
                <Tags className="mr-1 h-4 w-4" />
                {t("gallery.bulkTag", { count: selected.size })}
              </Button>
            )}
          </div>
          {selecting && folder && !folder.writable && <p className="text-xs text-muted-foreground">{t("gallery.bulkReadOnly")}</p>}
          {selecting && tagger === null && <p className="text-xs text-muted-foreground">{t("gallery.bulkNoTagger")}</p>}
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
      )}
      {folder && !folder.writable && <p className="text-xs text-muted-foreground">{t("gallery.readOnlyHint")}</p>}

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
                  onOpen={() => setViewing(index)}
                  onToggleSelect={() => toggleSelected(picture.name)}
                  onSearchTag={(tag) => setSearchText(exactTagQuery(tag))}
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
      {!page.loading && page.pictures.length === 0 && !page.error && (
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

      <ImageLightbox
        items={items}
        index={viewing}
        onIndexChange={setViewing}
        onClose={() => setViewing(null)}
        hasMore={page.hasMore}
        onLoadMore={page.loadMore}
        renderPanel={() =>
          viewed ? (
            <GalleryPanel
              picture={viewed}
              writable={folder?.writable ?? false}
              canTag={tagger !== null}
              secret={secret}
              onSearch={(tag) => {
                setViewing(null)
                // Quoted, so a tag of several words is searched as that one tag.
                setSearchText(exactTagQuery(tag))
              }}
              onMetaChange={page.patch}
            />
          ) : null
        }
      />
    </div>
  )
}

/** The models named in these pictures, sorted. */
function modelsIn(pictures: GalleryPicture[]): string[] {
  const models = new Set<string>()
  for (const picture of pictures) if (picture.meta?.model) models.add(picture.meta.model)
  return [...models].sort((a, b) => a.localeCompare(b))
}

/** Both lists in one, sorted; `known` itself when `found` adds nothing. */
function mergeModels(known: string[], found: string[]): string[] {
  const added = found.filter((model) => !known.includes(model))
  return added.length ? [...known, ...added].sort((a, b) => a.localeCompare(b)) : known
}

// The gallery's column count by window width: 2, then 3 / 4 / 5 from
// Tailwind's sm / lg / xl.
const COLUMN_BREAKPOINTS: [string, number][] = [
  ["(min-width: 1280px)", 5],
  ["(min-width: 1024px)", 4],
  ["(min-width: 640px)", 3],
]

function subscribeToColumns(onChange: () => void) {
  const queries = COLUMN_BREAKPOINTS.map(([query]) => window.matchMedia(query))
  queries.forEach((query) => query.addEventListener("change", onChange))
  return () => queries.forEach((query) => query.removeEventListener("change", onChange))
}

function currentColumns() {
  return COLUMN_BREAKPOINTS.find(([query]) => window.matchMedia(query).matches)?.[1] ?? 2
}

function useColumnCount() {
  return useSyncExternalStore(subscribeToColumns, currentColumns, () => 2)
}
