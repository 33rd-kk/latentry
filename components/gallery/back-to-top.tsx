"use client"

import { useEffect, useState, type RefObject } from "react"
import { ArrowUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n"

/** Whether the window has scrolled more than one screen down. */
function scrolledFar(): boolean {
  return window.scrollY > window.innerHeight
}

/**
 * A round button at the bottom right that brings a long gallery back to its
 * top. It shows only once the page has scrolled more than a screen. Focus
 * moves to the top of the gallery (`top`), not into the search box, so a phone
 * doesn't open its keyboard.
 */
export function BackToTop({ top }: { top: RefObject<HTMLElement | null> }) {
  const t = useT()
  const [shown, setShown] = useState(false)

  useEffect(() => {
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        setShown(scrolledFar())
      })
    }
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll, { passive: true })
    return () => {
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
      cancelAnimationFrame(frame)
    }
  }, [])

  if (!shown) return null

  const label = t("gallery.backToTop")
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="fixed right-4 bottom-4 z-20 rounded-full shadow-md"
      aria-label={label}
      title={label}
      onClick={() => {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" })
        top.current?.focus({ preventScroll: true })
      }}
    >
      <ArrowUp />
    </Button>
  )
}
