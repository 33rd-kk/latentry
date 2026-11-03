"use client"

import { useRef, type KeyboardEvent } from "react"
import { Star } from "lucide-react"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"

const STARS = [1, 2, 3, 4, 5] as const

interface StarRatingProps {
  /** 0 for none. */
  value: number
  /** With 0 when the chosen star is chosen again. */
  onChange: (stars: number) => void
  disabled?: boolean
  className?: string
}

/**
 * Five stars as a radio group: arrows move along it, and choosing the star
 * already chosen takes the rating away.
 */
export function StarRating({ value, onChange, disabled, className }: StarRatingProps) {
  const t = useT()
  const buttons = useRef<(HTMLButtonElement | null)[]>([])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 0
    if (!step) return
    // The viewer moves between pictures on the arrows too; here they move the rating.
    event.preventDefault()
    event.stopPropagation()
    const next = Math.min(5, Math.max(1, (value || 0) + step))
    onChange(next)
    buttons.current[next - 1]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={t("gallery.rating.label")}
      className={cn("flex items-center gap-0.5", className)}
      onKeyDown={onKeyDown}
    >
      {STARS.map((stars) => {
        const checked = value === stars
        return (
          <button
            key={stars}
            ref={(node) => {
              buttons.current[stars - 1] = node
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={t("gallery.rating.stars", { count: stars })}
            // One stop in the tab order: the chosen star, or the first.
            tabIndex={checked || (!value && stars === 1) ? 0 : -1}
            disabled={disabled}
            title={checked ? t("gallery.rating.clearHint") : t("gallery.rating.stars", { count: stars })}
            onClick={() => onChange(checked ? 0 : stars)}
            className="rounded p-0.5 text-white/70 hover:text-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-50"
          >
            <Star className={cn("h-4 w-4", stars <= value && "fill-amber-400 text-amber-400")} />
          </button>
        )
      })}
    </div>
  )
}

/** The stars a picture has, small, for its card. Nothing when it has none. */
export function StarBadge({ stars }: { stars?: number }) {
  const t = useT()
  if (!stars) return null
  return (
    <span
      className="absolute left-2 top-2 flex items-center gap-0.5 rounded-full bg-black/60 px-1.5 py-0.5 text-xs font-medium text-white"
      title={t("gallery.rating.stars", { count: stars })}
    >
      <Star aria-hidden className="h-3 w-3 fill-amber-400 text-amber-400" />
      <span aria-hidden>{stars}</span>
      <span className="sr-only">{t("gallery.rating.stars", { count: stars })}</span>
    </span>
  )
}
