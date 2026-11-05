"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Progress } from "@/components/ui/progress"
import { ImageLightbox, type LightboxItem } from "@/components/ui/image-lightbox"
import { useSecretMode, useShownInSecret } from "@/components/app-header"
import { GalleryPanel } from "./gallery-panel"
import { GalleryGrid } from "./gallery-grid"
import { GridSheetView } from "./grid-sheet-view"
import { GalleryNotConfigured } from "./not-configured"
import { GalleryToolbar } from "./gallery-toolbar"
import { SelectionBar } from "./selection-bar"
import { FilterChips, FilterPanel } from "./gallery-filters"
import { CompareDialog } from "./compare-dialog"
import { useBackends } from "@/hooks/use-backends"
import { pictureUrl, useFolderFacets, useGalleryFolders, useGalleryPage, type GalleryPicture } from "@/hooks/use-gallery"
import { useGallerySelection } from "@/hooks/use-gallery-selection"
import { useLocalFlag } from "@/hooks/use-local-flag"
import { useSeenFacets } from "@/hooks/use-seen-facets"
import { useSeenTags } from "@/hooks/use-seen-tags"
import type { SuggestSource } from "@/lib/gallery/suggest"
import { listProfiles } from "@/lib/profiles"
import { exactTagQuery } from "@/lib/gallery/query"
import { toParams, type GalleryQuery } from "@/lib/gallery/filter"
import { useT } from "@/lib/i18n"

/**
 * The pictures in the configured folders, newest first unless another order
 * is chosen: the save folder (written with every setting) and any read-only
 * folders of other tools.
 */
export function Gallery() {
  const t = useT()
  const secret = useSecretMode()
  const { folders, canOpen } = useGalleryFolders()
  const { backends, tagger } = useBackends()
  const [dir, setDir] = useState<number | null>(null)
  const [searchText, setSearchText] = useState("")
  const [q, setQ] = useState("")
  // The order and filters live only as long as the page: nothing about what
  // was looked for is kept in the browser or the address bar.
  const [filters, setFilters] = useState<Omit<GalleryQuery, "q">>({})
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [comparing, setComparing] = useState<[GalleryPicture, GalleryPicture] | null>(null)
  const [viewing, setViewing] = useState<number | null>(null)
  // Secret mode: the one picture shown with "Show", forgotten on every move
  // in the viewer (coming back included) and when it closes.
  const [revealedKey, setRevealedKey] = useShownInSecret<string>()

  const activeDir = dir ?? folders?.[0]?.index ?? null
  const folder = folders?.find((candidate) => candidate.index === activeDir) ?? null
  const query = useMemo<GalleryQuery>(() => ({ ...filters, q }), [filters, q])
  const changeFilters = useCallback((patch: Partial<GalleryQuery>) => setFilters((current) => ({ ...current, ...patch })), [])
  const page = useGalleryPage(activeDir, query)
  const profiles = useMemo(() => listProfiles().map(({ id, label }) => ({ id, label })), [])

  const seenFacets = useSeenFacets(activeDir, page.pictures)
  // The search box's suggestions: only from the pictures this page has shown.
  const seenTags = useSeenTags(activeDir, page.pictures)
  const suggestSource = useMemo<SuggestSource>(
    () => ({ tags: seenTags.tags, samplers: seenTags.samplers, models: seenFacets.models, loras: seenFacets.loras }),
    [seenTags, seenFacets.models, seenFacets.loras]
  )
  // The whole folder's names, asked for only while the panel is open, and
  // never in secret mode (the panel shows no names then).
  const folderFacets = useFolderFacets(activeDir, filtersOpen && !secret)

  // Tags under each card, on or off for every card at once, remembered here.
  const [showTags, setShowTags] = useLocalFlag("latentry:gallery-show-tags", false)
  const selection = useGallerySelection(activeDir, `${activeDir}|${toParams(query)}`, page)

  // The search tips that came before the suggestions remembered being hidden
  // here; nothing reads that any more, so it is not left behind.
  useEffect(() => {
    try {
      localStorage.removeItem("latentry:search-hint-hidden")
    } catch {
      // Storage blocked: there is nothing there either.
    }
  }, [])

  // The search applies after typing pauses, not on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setQ(searchText.trim()), 300)
    return () => clearTimeout(timer)
  }, [searchText])

  const items = useMemo<LightboxItem[]>(
    // No save button of the viewer's own: it would save the file with its
    // settings. The side panel offers saving without them first.
    () => page.pictures.map((picture) => ({ src: pictureUrl(picture), name: picture.name })),
    [page.pictures]
  )

  // Stars show at once and go back if saving fails; the failed picture is
  // remembered by its key, so the note stays with that picture.
  const [rateError, setRateError] = useState<string | null>(null)
  const { rate: rateOnPage } = page
  const rate = useCallback(
    async (picture: GalleryPicture, stars: number) => {
      if (secret) return
      setRateError(null)
      if (!(await rateOnPage(picture, stars))) setRateError(`${picture.dir}/${picture.name}`)
    },
    [rateOnPage, secret]
  )

  // In the viewer, 1–5 give that many stars; the same number again takes them
  // away. (0 is the viewer's own: it resets the zoom.)
  const shown = viewing !== null ? (page.pictures[viewing] ?? null) : null
  useEffect(() => {
    if (!shown || secret) return
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || !/^[1-5]$/.test(event.key)) return
      const target = event.target as HTMLElement | null
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return
      const stars = Number(event.key)
      void rate(shown, shown.stars === stars ? 0 : stars)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [shown, secret, rate])

  if (folders && folders.length === 0) return <GalleryNotConfigured />

  const viewed = viewing !== null ? page.pictures[viewing] : null
  const viewedKey = viewed ? `${viewed.dir}/${viewed.name}` : null
  const revealed = viewedKey !== null && revealedKey === viewedKey

  return (
    <div className="space-y-4">
      <GalleryToolbar
        folders={folders}
        activeDir={activeDir}
        onDir={setDir}
        searchText={searchText}
        onSearchText={setSearchText}
        secret={secret}
        suggestSource={suggestSource}
        suggestFrom={seenTags.pictureCount}
        query={query}
        onChange={changeFilters}
        filtersOpen={filtersOpen}
        onToggleFilters={() => setFiltersOpen(!filtersOpen)}
        page={page}
        showTags={showTags}
        onShowTags={setShowTags}
        selection={selection}
      />
      <FilterPanel
        open={filtersOpen}
        query={query}
        onChange={changeFilters}
        backends={backends.map((option) => option.id)}
        profiles={profiles}
        facets={folderFacets.facets ?? seenFacets}
        facetsProgress={folderFacets.progress}
        secret={secret}
      />
      <FilterChips query={query} onChange={changeFilters} profiles={profiles} secret={secret} />
      {page.indexing &&
        ("tooLarge" in page.indexing ? (
          <p className="text-sm text-muted-foreground">{t("gallery.sort.tooLarge", { total: page.indexing.total })}</p>
        ) : (
          <div className="mx-auto max-w-md space-y-1 py-8 text-center text-sm text-muted-foreground">
            <p>{t("gallery.sort.indexing", { done: page.indexing.done, total: page.indexing.total })}</p>
            <Progress value={(page.indexing.done / Math.max(1, page.indexing.total)) * 100} />
          </div>
        ))}

      <SelectionBar selection={selection} pictures={page.pictures} folder={folder} canTag={tagger !== null} onCompare={setComparing} />
      {folder && !folder.writable && <p className="text-xs text-muted-foreground">{t("gallery.readOnlyHint")}</p>}

      {/* An opened X/Y grid stack is shown as the grid; anything else as cards. */}
      {query.group === "grid" && query.stack ? (
        <GridSheetView page={page} secret={secret} onOpen={setViewing} />
      ) : (
        <GalleryGrid
          page={page}
          secret={secret}
          showTags={showTags}
          selection={selection}
          onOpen={setViewing}
          onChange={changeFilters}
          onSearchText={setSearchText}
        />
      )}

      <CompareDialog pair={comparing} onClose={() => setComparing(null)} secret={secret} />
      <ImageLightbox
        items={items}
        index={viewing}
        onIndexChange={(index) => {
          setViewing(index)
          setRevealedKey(null)
        }}
        onClose={() => {
          setViewing(null)
          setRevealedKey(null)
        }}
        hasMore={page.hasMore}
        onLoadMore={page.loadMore}
        veiled={secret}
        shownSrc={revealed && viewed ? pictureUrl(viewed) : null}
        panelOpenOnStart={secret}
        renderPanel={() =>
          viewed ? (
            <GalleryPanel
              picture={viewed}
              writable={folder?.writable ?? false}
              canTag={tagger !== null}
              canOpen={canOpen}
              secret={secret}
              revealed={revealed}
              onReveal={() => setRevealedKey(viewedKey)}
              onSearch={(tag) => {
                setViewing(null)
                setRevealedKey(null)
                // Quoted, so a tag of several words is searched as that one tag.
                setSearchText(exactTagQuery(tag))
              }}
              onMetaChange={page.patch}
              onRate={(stars) => void rate(viewed, stars)}
              rateError={rateError === viewedKey}
            />
          ) : null
        }
      />
    </div>
  )
}
