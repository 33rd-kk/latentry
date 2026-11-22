"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { GalleryQuery } from "@/lib/gallery/filter"
import { useT } from "@/lib/i18n"

/**
 * An opened stack is a step into it, so the browser's Back (and a phone's
 * back gesture) steps out again rather than leaving the gallery. Opening adds
 * one history entry for the same address, with nothing in it: the stack's
 * key is a hash of a prompt or a seed, and stays in this page's memory like
 * the rest of the search.
 */
export function useOpenStack(stack: string | undefined, setStack: (key: string | undefined) => void) {
  // Whether the entry added on opening is the one the browser is on.
  const pushed = useRef(false)
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    const onPop = () => {
      if (!pushed.current) return
      pushed.current = false
      setStack(undefined)
    }
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [setStack])

  // Left some other way (another Stack choice, Clear all, another folder):
  // the entry goes too, so Back does not step out of a stack already left.
  useEffect(() => {
    if (stack || !pushed.current) return
    pushed.current = false
    window.history.back()
  }, [stack])

  const open = useCallback(
    (key: string, pictures: number) => {
      if (!pushed.current) {
        window.history.pushState({}, "")
        pushed.current = true
      }
      setCount(pictures)
      setStack(key)
    },
    [setStack]
  )

  // As Back: the entry goes, and popstate closes the stack.
  const close = useCallback(() => {
    if (pushed.current) window.history.back()
    else setStack(undefined)
  }, [setStack])

  return { open, close, count }
}

/** Above the pictures of an opened stack: what it is, and the way out. */
export function StackBar({ group, count, onBack }: { group: NonNullable<GalleryQuery["group"]>; count: number | null; onBack: () => void }) {
  const t = useT()
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border bg-muted/40 px-2 py-1.5 text-sm">
      <Button type="button" variant="outline" size="sm" onClick={onBack}>
        <ArrowLeft className="mr-1 h-4 w-4" />
        {t("gallery.stackBar.back")}
      </Button>
      <span className="text-muted-foreground">
        {t(`gallery.filter.group-${group}`)}
        {count !== null && ` · ${t("gallery.stackBar.count", { count })}`}
      </span>
    </div>
  )
}
