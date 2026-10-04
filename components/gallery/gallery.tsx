"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { FolderOpen, Loader2, Lock, RefreshCw, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ImageLightbox, type LightboxItem } from "@/components/ui/image-lightbox"
import { useSecretMode } from "@/components/app-header"
import { GalleryPanel } from "./gallery-panel"
import { SearchHint, SearchHintToggle } from "./search-hint"
import { useBackends } from "@/hooks/use-backends"
import { pictureUrl, useGalleryFolders, useGalleryPage, type GalleryPicture } from "@/hooks/use-gallery"
import { listProfiles } from "@/lib/profiles"
import { exactTagQuery } from "@/lib/gallery/query"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"

const ALL = "__all__"

/**
 * The pictures in the configured folders, newest first: the save folder
 * (written with every setting) and any read-only folders of other tools.
 */
export function Gallery() {
  const t = useT()
  const secret = useSecretMode()
  const folders = useGalleryFolders()
  const { backends, tagger } = useBackends()
  const [dir, setDir] = useState<number | null>(null)
  const [query, setQuery] = useState("")
  const [searchFocused, setSearchFocused] = useState(false)
  const [q, setQ] = useState("")
  const [backend, setBackend] = useState(ALL)
  const [profile, setProfile] = useState(ALL)
  const [viewing, setViewing] = useState<number | null>(null)
  const sentinel = useRef<HTMLDivElement>(null)

  const activeDir = dir ?? folders?.[0]?.index ?? null
  const folder = folders?.find((candidate) => candidate.index === activeDir) ?? null
  const filter = useMemo(
    () => ({ q, backend: backend === ALL ? undefined : backend, profile: profile === ALL ? undefined : profile }),
    [q, backend, profile]
  )
  const page = useGalleryPage(activeDir, filter)

  // The search applies after typing pauses, not on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setQ(query.trim()), 300)
    return () => clearTimeout(timer)
  }, [query])

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
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder={t("gallery.search")}
            className="pl-8"
          />
        </div>
        <SearchHintToggle />
        <Select value={backend} onValueChange={setBackend}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("gallery.allBackends")}</SelectItem>
            {backends.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={profile} onValueChange={setProfile}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("gallery.allProfiles")}</SelectItem>
            {listProfiles().map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon" onClick={page.reload} aria-label={t("gallery.refresh")} title={t("gallery.refresh")}>
          <RefreshCw className={cn("h-4 w-4", page.loading && "animate-spin")} />
        </Button>
      </div>
      <SearchHint visible={searchFocused || query.trim().length > 0} />
      {folder && !folder.writable && <p className="text-xs text-muted-foreground">{t("gallery.readOnlyHint")}</p>}

      <div className="columns-2 gap-3 sm:columns-3 lg:columns-4 xl:columns-5">
        {page.pictures.map((picture, index) => (
          <GalleryCard key={`${picture.dir}/${picture.name}`} picture={picture} secret={secret} onOpen={() => setViewing(index)} />
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
                setQuery(exactTagQuery(tag))
              }}
              onMetaChange={page.patch}
            />
          ) : null
        }
      />
    </div>
  )
}

function GalleryCard({ picture, secret, onOpen }: { picture: GalleryPicture; secret: boolean; onOpen: () => void }) {
  const t = useT()
  const ratio = picture.width && picture.height ? `${picture.width} / ${picture.height}` : "1 / 1"
  const caption = picture.meta?.prompt
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative mb-3 block w-full break-inside-avoid overflow-hidden rounded-md border bg-muted/40 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ aspectRatio: ratio }}
      title={secret ? picture.name : caption || picture.name}
    >
      <img
        src={pictureUrl(picture, true)}
        alt={secret ? picture.name : caption?.slice(0, 120) || picture.name}
        loading="lazy"
        className={cn("h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]", secret && "blur-xl")}
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-1 bg-gradient-to-t from-black/70 to-transparent p-1.5 opacity-0 transition group-hover:opacity-100">
        <span className="truncate text-[10px] text-white/90">{picture.meta?.backend ?? picture.meta?.source ?? ""}</span>
        {picture.meta?.tags?.length ? <span className="text-[10px] text-white/80">{t("gallery.tagged")}</span> : null}
      </div>
    </button>
  )
}
