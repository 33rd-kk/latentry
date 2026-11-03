"use client"

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { PRIVATE_TEXT } from "@/lib/secret-mode"
import { applySuggestion, suggest, termAt, type Suggestion, type SuggestSource } from "@/lib/gallery/suggest"
import { cn } from "@/lib/utils"
import { useT, type MessageKey } from "@/lib/i18n"

/**
 * The gallery's search box, with suggestions as you type: the tags of the
 * pictures shown so far, the settings a term can name and their values, and
 * how to write a search (lib/gallery/suggest.ts). A combobox: ↓ and ↑ move
 * through the list, Enter or Tab takes the one marked, Esc closes it.
 * Nothing is marked until ↓ is pressed, so Enter alone never changes the text.
 */
export function SearchBox({
  value,
  onChange,
  onFocusChange,
  secret,
  source,
  pictureCount,
}: {
  value: string
  onChange: (text: string) => void
  onFocusChange: (focused: boolean) => void
  secret: boolean
  source: SuggestSource
  /** How many pictures the tags come from, for the note under the list. */
  pictureCount: number
}) {
  const t = useT()
  const id = useId()
  const listId = `${id}-list`
  const noteId = `${id}-note`
  const input = useRef<HTMLInputElement>(null)
  const [caret, setCaret] = useState(0)
  const [focused, setFocused] = useState(false)
  const [active, setActive] = useState(-1)
  const [dismissed, setDismissed] = useState(false)

  const term = useMemo(() => termAt(value, Math.min(caret, value.length)), [value, caret])
  const items = useMemo(() => suggest(term, source, { secret }), [term, source, secret])
  const open = focused && !dismissed && items.length > 0
  const marked = active < items.length ? active : -1

  const readCaret = () => setCaret(input.current?.selectionStart ?? value.length)
  const choose = (suggestion: Suggestion) => {
    const next = applySuggestion(value, term, suggestion)
    onChange(next.text)
    setActive(-1)
    setCaret(next.caret)
    // After React has put the new text in.
    requestAnimationFrame(() => input.current?.setSelectionRange(next.caret, next.caret))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // While an IME is composing, its keys are its own.
    if (event.nativeEvent.isComposing) return
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!open) {
        setDismissed(false)
        return
      }
      event.preventDefault()
      // Around the list, through "none marked" between its ends.
      const next = marked + (event.key === "ArrowDown" ? 1 : -1)
      setActive(next >= items.length ? -1 : next < -1 ? items.length - 1 : next)
    } else if ((event.key === "Enter" || event.key === "Tab") && open && marked >= 0) {
      event.preventDefault()
      choose(items[marked])
    } else if (event.key === "Escape" && open) {
      event.preventDefault()
      setDismissed(true)
      setActive(-1)
    }
  }

  const kindLabel = (suggestion: Suggestion) =>
    suggestion.kind === "tag" ? t("gallery.suggest.count", { count: suggestion.count ?? 0 }) : t(`gallery.suggest.kind.${suggestion.kind}` as MessageKey)
  const about = (suggestion: Suggestion) =>
    suggestion.name ? t(`gallery.suggest.about.${suggestion.name}` as MessageKey) : null

  return (
    <div className="relative min-w-48 flex-1">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        {...PRIVATE_TEXT}
        ref={input}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && marked >= 0 ? `${id}-option-${marked}` : undefined}
        aria-describedby={open ? noteId : undefined}
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
          setCaret(event.target.selectionStart ?? event.target.value.length)
          setDismissed(false)
          setActive(-1)
        }}
        onKeyDown={onKeyDown}
        onKeyUp={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End") readCaret()
        }}
        onClick={readCaret}
        onFocus={() => {
          setFocused(true)
          readCaret()
          onFocusChange(true)
        }}
        onBlur={() => {
          setFocused(false)
          setActive(-1)
          onFocusChange(false)
        }}
        placeholder={t("gallery.search")}
        className="pl-8"
      />
      <div className={cn("absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md", !open && "hidden")}>
        <ul id={listId} role="listbox" aria-label={t("gallery.suggest.label")} className="max-h-72 overflow-y-auto py-1">
          {open &&
            items.map((suggestion, index) => (
              <li
                key={`${suggestion.kind}:${suggestion.insert}`}
                id={`${id}-option-${index}`}
                role="option"
                aria-selected={index === marked}
                // Before the input's blur, so the click lands.
                onMouseDown={(event) => {
                  event.preventDefault()
                  choose(suggestion)
                }}
                onMouseEnter={() => setActive(index)}
                className={cn("flex cursor-pointer items-baseline gap-2 px-3 py-1.5 text-sm", index === marked && "bg-accent text-accent-foreground")}
              >
                <span className="truncate font-medium">{suggestion.label}</span>
                {about(suggestion) && <span className="truncate text-xs text-muted-foreground">{about(suggestion)}</span>}
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">{kindLabel(suggestion)}</span>
              </li>
            ))}
        </ul>
        {open && (
          <p id={noteId} className="border-t px-3 py-1.5 text-xs text-muted-foreground">
            {secret ? t("gallery.suggest.noteSecret") : t("gallery.suggest.note", { count: pictureCount })}
          </p>
        )}
      </div>
    </div>
  )
}
