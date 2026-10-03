"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { Check, Copy, Search, Wand2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"

export interface LightboxTagSection {
  label: string
  /** As the prompt spells them; copied and handed over as they are. */
  tags: string[]
}

interface LightboxTagPanelProps {
  /** Heading over the sections, e.g. which picture this is. */
  title?: string
  sections: LightboxTagSection[]
  /** Adds the tag to the gallery's search. Absent, there is no button. */
  onSearch?: (tag: string) => void
  /** Present when the generator is available. */
  onSendTag?: (tag: string, target: "positive" | "negative") => void
}

// Display only: unescape Danbooru-style escaped parens/brackets.
const displayTag = (tag: string) => tag.replace(/\\([()[\]])/g, "$1")

/**
 * The full-screen viewer's side panel: one image's tags, each with the actions
 * the panel offers. The viewer sits above every toast, so what an action did is
 * said here instead.
 */
export function LightboxTagPanel({ title, sections, onSearch, onSendTag }: LightboxTagPanelProps) {
  const t = useT()
  const [selection, setSelection] = useState<{ identity: string; key: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // A selection belongs to the image it was made on; a new image starts with none.
  const identity = `${title ?? ""}|${sections.map((s) => s.tags.join(",")).join("|")}`
  const activeTag = selection?.identity === identity ? selection.key : null
  const setActiveTag = (key: string | null) => setSelection(key === null ? null : { identity, key })
  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
  }, [])

  const say = (text: string) => {
    setNotice(text)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 1600)
  }

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      say(t("lightbox.copiedWhat", { what }))
    } catch {
      say(t("lightbox.copyFailed"))
    }
  }

  const visible = sections.filter((section) => section.tags.length > 0)

  return (
    <div className="space-y-4 text-left">
      {title && <p className="truncate text-xs font-medium text-white/60">{title}</p>}

      {/* Zero height, so the notice floats over the tags instead of pushing them down. */}
      <div className="sticky top-0 z-10 h-0">
        <p
          role="status"
          aria-live="polite"
          className={cn(
            "flex items-center gap-1.5 rounded-md bg-emerald-500/90 px-2 py-1 text-xs font-medium text-white shadow transition-opacity",
            notice ? "opacity-100" : "pointer-events-none opacity-0"
          )}
        >
          <Check className="h-3 w-3" />
          {notice ?? ""}
        </p>
      </div>

      {visible.length === 0 && <p className="text-xs text-white/50">{t("lightbox.noTags")}</p>}

      {visible.map((section) => (
        <section key={section.label} className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-white/55">{section.label}</h3>
            <button
              type="button"
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-white/55 hover:bg-white/10 hover:text-white"
              onClick={() => void copy(section.tags.join(", "), section.label)}
            >
              <Copy className="h-3 w-3" />
              {t("lightbox.copyAll")}
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {section.tags.map((tag) => {
              const key = `${section.label}:${tag}`
              const active = activeTag === key
              return (
                <div key={key} className="contents">
                  <button
                    type="button"
                    aria-expanded={active}
                    onClick={() => setActiveTag(active ? null : key)}
                    className={cn(
                      "max-w-full break-words rounded px-1.5 py-0.5 text-left text-xs transition-colors",
                      active ? "bg-sky-400/30 text-white ring-1 ring-sky-300/60" : "bg-white/10 text-white/85 hover:bg-white/20"
                    )}
                  >
                    {displayTag(tag)}
                  </button>
                  {active && (
                    <div className="flex w-full flex-wrap gap-1 rounded-md bg-white/5 p-1">
                      <PanelAction icon={<Copy className="h-3 w-3" />} onClick={() => void copy(tag, displayTag(tag))}>
                        {t("lightbox.copy")}
                      </PanelAction>
                      {onSearch && (
                        <PanelAction icon={<Search className="h-3 w-3" />} onClick={() => onSearch(tag)}>
                          {t("lightbox.addToSearch")}
                        </PanelAction>
                      )}
                      {onSendTag && (
                        <>
                          <PanelAction
                            icon={<Wand2 className="h-3 w-3" />}
                            onClick={() => {
                              onSendTag(tag, "positive")
                              say(t("lightbox.addedPositive", { tag: displayTag(tag) }))
                            }}
                          >
                            {t("lightbox.toPositive")}
                          </PanelAction>
                          <PanelAction
                            icon={<Wand2 className="h-3 w-3" />}
                            onClick={() => {
                              onSendTag(tag, "negative")
                              say(t("lightbox.addedNegative", { tag: displayTag(tag) }))
                            }}
                          >
                            {t("lightbox.toNegative")}
                          </PanelAction>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

function PanelAction({ icon, onClick, children }: { icon: ReactNode; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 rounded px-2 py-1 text-xs text-white/85 hover:bg-white/15 hover:text-white"
    >
      {icon}
      {children}
    </button>
  )
}
