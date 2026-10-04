"use client"

import { memo, useMemo, useState } from "react"
import { Check } from "lucide-react"
import { pictureUrl, type GalleryPicture } from "@/hooks/use-gallery"
import { normalizeTag } from "@/lib/gallery/query"
import { tagForPrompt } from "@/lib/tag-groups"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"

/** Tags shown before the footer offers "+N". */
const COLLAPSED_TAGS = 8
const WD14_CHARACTER = 4

/**
 * What a card lists: the WD14 tags when the picture has been tagged (they say
 * what is in it, whoever made it), else the prompt's tags. Characters first.
 */
export function cardTags(picture: GalleryPicture): { tags: string[]; from: "wd14" | "prompt" | null } {
  const wd14 = picture.meta?.tags ?? []
  if (wd14.length) {
    const ordered = [...wd14.filter((tag) => tag.category === WD14_CHARACTER), ...wd14.filter((tag) => tag.category !== WD14_CHARACTER)]
    return { tags: ordered.map((tag) => tagForPrompt(tag.name)), from: "wd14" }
  }
  const prompt = (picture.meta?.prompt ?? "").split(",").map(normalizeTag).filter(Boolean)
  return prompt.length ? { tags: [...new Set(prompt)], from: "prompt" } : { tags: [], from: null }
}

interface GalleryCardProps {
  picture: GalleryPicture
  secret: boolean
  showTags: boolean
  selecting: boolean
  selected: boolean
  onOpen: () => void
  onToggleSelect: () => void
  onSearchTag: (tag: string) => void
}

export const GalleryCard = memo(function GalleryCard({
  picture,
  secret,
  showTags,
  selecting,
  selected,
  onOpen,
  onToggleSelect,
  onSearchTag,
}: GalleryCardProps) {
  const t = useT()
  const [expanded, setExpanded] = useState(false)
  const ratio = picture.width && picture.height ? `${picture.width} / ${picture.height}` : "1 / 1"
  const caption = picture.meta?.prompt
  const { tags, from } = useMemo(() => cardTags(picture), [picture])
  const visible = expanded ? tags : tags.slice(0, COLLAPSED_TAGS)

  return (
    <div
      className={cn(
        "mb-3 break-inside-avoid overflow-hidden rounded-md border bg-card",
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-background"
      )}
    >
      <button
        type="button"
        onClick={selecting ? onToggleSelect : onOpen}
        aria-pressed={selecting ? selected : undefined}
        className="group relative block w-full overflow-hidden bg-muted/40 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        style={{ aspectRatio: ratio }}
        title={secret ? picture.name : caption || picture.name}
      >
        <img
          src={pictureUrl(picture, true)}
          alt={secret ? picture.name : caption?.slice(0, 120) || picture.name}
          loading="lazy"
          className={cn("h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]", secret && "blur-xl")}
        />
        {selecting && (
          <span
            aria-hidden
            className={cn(
              "absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-md border-2 shadow",
              selected ? "border-primary bg-primary text-primary-foreground" : "border-white/90 bg-black/30"
            )}
          >
            {selected && <Check className="h-4 w-4" />}
          </span>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-1 bg-gradient-to-t from-black/70 to-transparent p-1.5 opacity-0 transition group-hover:opacity-100">
          <span className="truncate text-[10px] text-white/90">{picture.meta?.backend ?? picture.meta?.source ?? ""}</span>
          {picture.meta?.tags?.length ? <span className="text-[10px] text-white/80">{t("gallery.tagged")}</span> : null}
        </div>
      </button>

      {showTags && !secret && (
        <div className="space-y-1 p-1.5">
          {tags.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">{t("gallery.cardNoTags")}</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {from === "prompt" && <span className="sr-only">{t("gallery.prompt")}</span>}
              {visible.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => onSearchTag(tag)}
                  title={t("gallery.cardSearchTag", { tag })}
                  className={cn(
                    "max-w-full truncate rounded px-1.5 py-0.5 text-[11px] leading-4 transition-colors",
                    from === "wd14" ? "bg-secondary text-secondary-foreground hover:bg-primary/15" : "bg-muted text-muted-foreground hover:bg-primary/15"
                  )}
                >
                  {tag}
                </button>
              ))}
              {tags.length > COLLAPSED_TAGS && (
                <button
                  type="button"
                  onClick={() => setExpanded((open) => !open)}
                  className="rounded px-1.5 py-0.5 text-[11px] font-medium text-primary hover:underline"
                >
                  {expanded ? t("gallery.cardLess") : `+${tags.length - COLLAPSED_TAGS}`}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
})
