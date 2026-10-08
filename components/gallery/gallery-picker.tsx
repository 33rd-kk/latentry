"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useSecretMode } from "@/components/app-header"
import { PRIVATE_TEXT } from "@/lib/secret-mode"
import { pictureUrl, useGalleryFolders, useGalleryPage, type GalleryPicture } from "@/hooks/use-gallery"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

interface GalleryPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** Called with the picked picture's full-size URL; the picker closes itself. */
  onPick: (url: string, picture: GalleryPicture) => void
}

/**
 * A gallery picture as a source: the same folders and search as the gallery
 * page, one click to choose. It opens in place, under the button that asked
 * for it, rather than as a dialog over the page: the page and its header stay
 * in reach, so secret mode is one tap away while pictures are on screen.
 */
export function GalleryPicker({ open, onOpenChange, title, onPick }: GalleryPickerProps) {
  const t = useT()
  const secret = useSecretMode()
  const { folders } = useGalleryFolders()
  const [dir, setDir] = useState<number | null>(null)
  const [query, setQuery] = useState("")
  const [q, setQ] = useState("")
  const activeDir = dir ?? folders?.[0]?.index ?? null
  const page = useGalleryPage(open ? activeDir : null, { q })
  const sentinel = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLElement>(null)

  // Brought into view when it opens; Esc closes it, as it did as a dialog.
  useEffect(() => {
    if (!open) return
    panel.current?.scrollIntoView({ block: "start", behavior: "smooth" })
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onOpenChange])

  // The search applies after typing pauses, not on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setQ(query.trim()), 300)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    const node = sentinel.current
    if (!node || !page.hasMore) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void page.loadMore()
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [page])

  if (!open) return null
  return (
    <section ref={panel} aria-label={title} className="scroll-mt-16 space-y-3 rounded-md border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("generate.pickerClose")}
          title={t("generate.pickerClose")}
          onClick={() => onOpenChange(false)}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

        {folders && folders.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("gallery.notConfigured")}</p>
        ) : (
          <div className="flex min-h-0 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {folders && folders.length > 1 && (
                <Tabs value={String(activeDir)} onValueChange={(value) => setDir(Number(value))}>
                  <TabsList>
                    {folders.map((folder) => (
                      <TabsTrigger key={folder.index} value={String(folder.index)}>
                        {folder.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              )}
              <div className="relative min-w-40 flex-1">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  {...PRIVATE_TEXT}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("gallery.search")}
                  className="h-8 pl-7 text-xs"
                />
              </div>
            </div>

            <div className="max-h-[50vh] overflow-y-auto">
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {page.pictures.map((picture) => (
                  <button
                    key={`${picture.dir}/${picture.name}`}
                    type="button"
                    onClick={() => {
                      onPick(pictureUrl(picture), picture)
                      onOpenChange(false)
                    }}
                    className="group relative aspect-square overflow-hidden rounded-md border bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    title={picture.name}
                  >
                    <img
                      src={pictureUrl(picture, true)}
                      alt={secret ? picture.name : picture.meta?.prompt?.slice(0, 80) || picture.name}
                      loading="lazy"
                      className={cn("h-full w-full object-cover transition group-hover:scale-105", secret && "blur-xl")}
                    />
                  </button>
                ))}
              </div>
              <div ref={sentinel} className="h-6" />
              {page.loading && (
                <p className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t("gallery.loading")}
                </p>
              )}
              {!page.loading && page.pictures.length === 0 && !page.error && (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("gallery.empty")}</p>
              )}
              {page.error && <p className="text-xs text-destructive">{page.error}</p>}
            </div>
          </div>
        )}
    </section>
  )
}
