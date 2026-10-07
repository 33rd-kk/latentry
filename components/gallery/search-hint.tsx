"use client"

import { useSyncExternalStore } from "react"
import { CircleHelp, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n"

// Whether the search syntax hint is turned off: a per-browser convenience, so
// localStorage, and a failure there just means the hint shows.
const HIDDEN_KEY = "latentry:search-hint-hidden"
const CHANGE_EVENT = "latentry-search-hint"

function readHidden(): boolean {
  try {
    return localStorage.getItem(HIDDEN_KEY) === "1"
  } catch {
    return false
  }
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === HIDDEN_KEY) listener()
  }
  window.addEventListener(CHANGE_EVENT, listener)
  window.addEventListener("storage", onStorage)
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener)
    window.removeEventListener("storage", onStorage)
  }
}

function setHidden(hidden: boolean) {
  try {
    if (hidden) localStorage.setItem(HIDDEN_KEY, "1")
    else localStorage.removeItem(HIDDEN_KEY)
  } catch {
    // Not remembered; the choice lasts for this page.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function useSearchHintHidden(): [boolean, (hidden: boolean) => void] {
  return [useSyncExternalStore(subscribe, readHidden, () => false), setHidden]
}

/** The "?" next to the search box that brings a hidden hint back. */
export function SearchHintToggle() {
  const t = useT()
  const [hidden, set] = useSearchHintHidden()
  if (!hidden) return null
  return (
    <Button type="button" variant="ghost" size="icon" onClick={() => set(false)} aria-label={t("gallery.searchHintShow")} title={t("gallery.searchHintShow")}>
      <CircleHelp className="h-4 w-4" />
    </Button>
  )
}

/** How to write a search, shown while the search box is in use. */
export function SearchHint({ visible }: { visible: boolean }) {
  const t = useT()
  const [hidden, set] = useSearchHintHidden()
  if (!visible || hidden) return null
  const example = (code: string, text: string) => (
    <li className="flex flex-wrap items-baseline gap-x-2">
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">{code}</code>
      <span>{text}</span>
    </li>
  )
  return (
    <div role="note" className="flex items-start gap-3 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <ul className="flex-1 space-y-1">
        {example("long hair, smile", t("gallery.searchHintTerms"))}
        {example('"long hair"', t("gallery.searchHintExact"))}
        {example("long_hair", t("gallery.searchHintSpelling"))}
        {example("noobai", t("gallery.searchHintOther"))}
        {example("model:noobai, steps:>=30", t("gallery.searchHintFields"))}
        {example("-smile", t("gallery.searchHintExclude"))}
      </ul>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 shrink-0 px-1.5 text-xs"
        // Kept from taking focus, so hiding the hint does not close it by blurring the box first.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => set(true)}
      >
        <X className="mr-1 h-3 w-3" />
        {t("gallery.searchHintHide")}
      </Button>
    </div>
  )
}
