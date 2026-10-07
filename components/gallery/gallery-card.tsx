"use client"

import { memo, useEffect, useMemo, useRef, useState } from "react"
import { Check, ChevronUp, Layers } from "lucide-react"
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
  /** For a stack: shows the pictures in it, instead of opening this one. */
  onOpenStack?: () => void
}

export const GalleryCard = memo(function GalleryCard({
  picture,
  secret,
  showTags,
  selecting,
  selected,
  onOpen,
  onToggleSelect,
  onOpenStack,
  onSearchTag,
}: GalleryCardProps) {
  const t = useT()
  const [expanded, setExpanded] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  // An open tag list folds back by itself: a click or tap anywhere outside
  // the card, or Esc. On click rather than on press, so the outside click
  // lands first and the layout only shifts after it.
  useEffect(() => {
    if (!expanded) return
    const onClick = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setExpanded(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false)
    }
    document.addEventListener("click", onClick)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("click", onClick)
      document.removeEventListener("keydown", onKey)
    }
  }, [expanded])

  const collapse = () => {
    setExpanded(false)
    // A long list may have scrolled the card's top away; bring it back.
    const card = root.current
    if (card && card.getBoundingClientRect().top < 0) card.scrollIntoView({ block: "start", behavior: "smooth" })
  }
  const ratio = picture.width && picture.height ? `${picture.width} / ${picture.height}` : "1 / 1"
  const caption = picture.meta?.prompt
  const { tags, from } = useMemo(() => cardTags(picture), [picture])
  const visible = expanded ? tags : tags.slice(0, COLLAPSED_TAGS)

  return (
    <div
      ref={root}
      className={cn(
        "mb-3 break-inside-avoid overflow-hidden rounded-md border bg-card",
        // A stack looks like cards lying under this one.
        picture.stack && "mr-2.5 mb-5.5 shadow-[5px_5px_0_-1px_var(--card),5px_5px_0_0_var(--muted-foreground),10px_10px_0_-1px_var(--card),10px_10px_0_0_var(--muted-foreground)]",
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-background"
      )}
    >
      <button
        type="button"
        onClick={selecting ? onToggleSelect : (onOpenStack ?? onOpen)}
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
        {picture.stack && (
          <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-xs font-medium text-white" title={t("gallery.stackHint", { count: picture.stack.count })}>
            <Layers className="h-3 w-3" />
            {picture.stack.count}
          </span>
        )}
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
                  aria-expanded={expanded}
                  title={expanded ? t("gallery.cardLessHint") : t("gallery.cardMore", { count: tags.length - COLLAPSED_TAGS })}
                  onClick={() => (expanded ? collapse() : setExpanded(true))}
                  className={cn(
                    "flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[11px] font-medium leading-4 text-foreground transition-colors hover:bg-primary/10",
                    // A finger needs more to aim at than a pointer.
                    "pointer-coarse:px-2.5 pointer-coarse:py-1.5"
                  )}
                >
                  {expanded ? (
                    <>
                      <ChevronUp className="h-3 w-3" />
                      {t("gallery.cardLess")}
                    </>
                  ) : (
                    `+${tags.length - COLLAPSED_TAGS}`
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
})
