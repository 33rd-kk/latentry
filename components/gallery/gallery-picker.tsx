"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, Search } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useSecretMode } from "@/components/app-header"
import { pictureUrl, useGalleryFolders, useGalleryPage, type GalleryPicture } from "@/hooks/use-gallery"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

interface GalleryPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** Called with the picked picture's full-size URL; the dialog closes itself. */
  onPick: (url: string, picture: GalleryPicture) => void
}

/**
 * A gallery picture as a source: the same folders and search as the gallery
 * page, in a dialog, one click to choose.
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

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
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("gallery.search")}
                  className="h-8 pl-7 text-xs"
                />
              </div>
            </div>

            <div className="max-h-[60vh] overflow-y-auto">
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
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
      </DialogContent>
    </Dialog>
  )
}
