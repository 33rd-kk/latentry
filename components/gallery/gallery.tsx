"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Progress } from "@/components/ui/progress"
import { ImageLightbox, type LightboxItem } from "@/components/ui/image-lightbox"
import { useSecretMode, useShownInSecret } from "@/components/app-header"
import { GalleryPanel } from "./gallery-panel"
import { GalleryGrid } from "./gallery-grid"
import { GalleryNotConfigured } from "./not-configured"
import { GalleryToolbar } from "./gallery-toolbar"
import { SelectionBar } from "./selection-bar"
import { FilterChips, FilterPanel } from "./gallery-filters"
import { CompareDialog } from "./compare-dialog"
import { SearchHint } from "./search-hint"
import { useBackends } from "@/hooks/use-backends"
import { pictureUrl, useFolderFacets, useGalleryFolders, useGalleryPage, type GalleryPicture } from "@/hooks/use-gallery"
import { useGallerySelection } from "@/hooks/use-gallery-selection"
import { useLocalFlag } from "@/hooks/use-local-flag"
import { useSeenFacets } from "@/hooks/use-seen-facets"
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
  const [searchFocused, setSearchFocused] = useState(false)
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
  // The whole folder's names, asked for only while the panel is open, and
  // never in secret mode (the panel shows no names then).
  const folderFacets = useFolderFacets(activeDir, filtersOpen && !secret)

  // Tags under each card, on or off for every card at once, remembered here.
  const [showTags, setShowTags] = useLocalFlag("latentry:gallery-show-tags", false)
  const selection = useGallerySelection(activeDir, `${activeDir}|${toParams(query)}`, page)

  // The search applies after typing pauses, not on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setQ(searchText.trim()), 300)
    return () => clearTimeout(timer)
  }, [searchText])

  const items = useMemo<LightboxItem[]>(
    () => page.pictures.map((picture) => ({ src: pictureUrl(picture), name: picture.name, downloadName: picture.name })),
    [page.pictures]
  )

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
        onSearchFocus={setSearchFocused}
        query={query}
        onChange={changeFilters}
        filtersOpen={filtersOpen}
        onToggleFilters={() => setFiltersOpen(!filtersOpen)}
        page={page}
        showTags={showTags}
        onShowTags={setShowTags}
        selection={selection}
      />
      <SearchHint visible={searchFocused || searchText.trim().length > 0} />
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

      <GalleryGrid
        page={page}
        secret={secret}
        showTags={showTags}
        selection={selection}
        onOpen={setViewing}
        onChange={changeFilters}
        onSearchText={setSearchText}
      />

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
            />
          ) : null
        }
      />
    </div>
  )
}
