"use client"

import { useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { Eye, ImageUp, Loader2, PersonStanding, Tags, Wand2 } from "lucide-react"
import { LightboxTagPanel, type LightboxTagSection } from "@/components/ui/lightbox-tag-panel"
import { pictureUrl, type GalleryPicture } from "@/hooks/use-gallery"
import { pushHandoff } from "@/lib/storage"
import { splitTags, toSpacedTags } from "@/lib/tags"
import { tagForPrompt } from "@/lib/tag-groups"
import type { ImageMeta, ImageTag } from "@/lib/image-meta"
import { useT } from "@/lib/i18n"

interface GalleryPanelProps {
  picture: GalleryPicture
  writable: boolean
  /** Whether some backend can tag; without one the analyse button is hidden. */
  canTag: boolean
  secret: boolean
  onSearch: (tag: string) => void
  /** The picture's metadata after its tags were written back. */
  onMetaChange: (picture: GalleryPicture, meta: ImageMeta) => void
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

const WD14_CHARACTER = 4

/**
 * The viewer's side panel for one gallery picture: what it was made with, its
 * tags, and the ways back into the form. The viewer sits above every toast,
 * so outcomes are said here, in the panel.
 */
export function GalleryPanel({ picture, writable, canTag, secret, onSearch, onMetaChange }: GalleryPanelProps) {
  const t = useT()
  const router = useRouter()
  const meta = picture.meta
  const [tagging, setTagging] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  // Secret mode hides what describes the picture; "Show" lifts that for this
  // visit to the picture only. Moving to any other picture, coming back
  // included, hides it again: the reveal is forgotten on every change.
  const key = `${picture.dir}/${picture.name}`
  const [shownKey, setShownKey] = useState(key)
  const [revealed, setRevealed] = useState(false)
  if (shownKey !== key) {
    setShownKey(key)
    setRevealed(false)
  }
  const hidden = secret && !revealed

  const analyze = async () => {
    setTagging(true)
    setNote(null)
    try {
      const blob = await (await fetch(pictureUrl(picture))).blob()
      const response = await fetch("/api/gen/tag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_base64: await readAsDataUrl(blob) }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !Array.isArray(data?.tags)) {
        throw new Error(data?.error ? t.server(data.error) : t("gallery.tagFailed", { status: response.status }))
      }
      const tags = data.tags as ImageTag[]
      let saved = false
      if (writable) {
        const write = await fetch(`/api/gallery/${picture.dir}/${encodeURIComponent(picture.name)}/tags`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tags }),
        })
        saved = write.ok
      }
      onMetaChange(picture, { ...(meta ?? { source: "unknown", prompt: "", negativePrompt: "" }), tags })
      const result = saved ? t("gallery.tagsSaved") : writable ? t("gallery.tagsNotSaved") : t("gallery.tagsReadOnly")
      // The tags themselves stay hidden in secret mode; say that they exist.
      setNote(hidden ? `${result} ${t("gallery.tagsHidden", { count: tags.length })}` : result)
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error))
    } finally {
      setTagging(false)
    }
  }

  const sendSettings = () => {
    if (!meta) return
    pushHandoff({
      type: "settings",
      settings: {
        backend: meta.backend,
        profile: meta.profile,
        prompt: meta.prompt,
        negativePrompt: meta.negativePrompt,
        seed: meta.seed,
        width: meta.width ?? picture.width ?? undefined,
        height: meta.height ?? picture.height ?? undefined,
        steps: meta.steps,
        cfg: meta.cfg,
        sampler: meta.sampler,
        scheduler: meta.scheduler,
      },
    })
    router.push("/")
  }

  const sendSource = (as: "variation" | "pose") => {
    pushHandoff({ type: "source", url: pictureUrl(picture), as })
    router.push("/")
  }

  const sections: LightboxTagSection[] = []
  if (meta && !hidden) {
    sections.push({ label: t("gallery.prompt"), tags: splitTags(toSpacedTags(meta.prompt)), target: "positive" })
    sections.push({
      label: t("gallery.negative"),
      tags: splitTags(toSpacedTags(meta.negativePrompt)),
      target: "negative",
    })
  }
  // WD14 tags describe the picture as plainly as its prompt does.
  if (meta?.tags?.length && !hidden) {
    const named = meta.tags.filter((tag) => tag.category === WD14_CHARACTER).map((tag) => tagForPrompt(tag.name))
    const general = meta.tags.filter((tag) => tag.category !== WD14_CHARACTER).map((tag) => tagForPrompt(tag.name))
    if (named.length) sections.push({ label: t("gallery.wd14Character"), tags: named, target: "positive" })
    sections.push({ label: t("gallery.wd14"), tags: general, target: "positive" })
  }

  const facts: [string, ReactNode][] = []
  if (meta) {
    if (meta.backend) facts.push([t("gallery.backend"), `${meta.backend}${meta.profile ? ` · ${meta.profile}` : ""}`])
    if (meta.model) facts.push([t("gallery.model"), meta.model])
    if (meta.mode) facts.push([t("gallery.mode"), meta.mode])
    if (meta.seed !== undefined) facts.push([t("gallery.seed"), meta.seed])
    const width = meta.width ?? picture.width
    const height = meta.height ?? picture.height
    if (width && height) facts.push([t("gallery.size"), `${width}×${height}`])
    if (meta.steps !== undefined) facts.push([t("gallery.steps"), meta.steps])
    if (meta.cfg !== undefined) facts.push([t("gallery.cfg"), meta.cfg])
    if (meta.sampler) facts.push([t("gallery.sampler"), [meta.sampler, meta.scheduler].filter(Boolean).join(" / ")])
    if (meta.strength !== undefined) facts.push([t("gallery.strength"), meta.strength])
  }

  const action = "flex items-center gap-1 rounded px-2 py-1 text-xs text-white/85 hover:bg-white/15 hover:text-white disabled:opacity-50"

  return (
    <div className="space-y-4 text-left">
      <p className="truncate text-xs font-medium text-white/60" title={picture.name}>
        {picture.name}
      </p>

      <div className="flex flex-wrap gap-1">
        {meta && meta.prompt && (
          <button type="button" className={action} onClick={sendSettings} title={t("gallery.useSettingsHint")}>
            <Wand2 className="h-3 w-3" />
            {t("gallery.useSettings")}
          </button>
        )}
        <button type="button" className={action} onClick={() => sendSource("variation")} title={t("gallery.useAsSourceHint")}>
          <ImageUp className="h-3 w-3" />
          {t("gallery.useAsSource")}
        </button>
        <button type="button" className={action} onClick={() => sendSource("pose")} title={t("gallery.useAsPoseHint")}>
          <PersonStanding className="h-3 w-3" />
          {t("gallery.useAsPose")}
        </button>
        {canTag && (
          <button
            type="button"
            className={action}
            onClick={() => void analyze()}
            disabled={tagging}
            title={t("gallery.analyzeHint")}
          >
            {tagging ? <Loader2 className="h-3 w-3 animate-spin" /> : <Tags className="h-3 w-3" />}
            {meta?.tags?.length ? t("gallery.reanalyze") : t("gallery.analyze")}
          </button>
        )}
      </div>
      {note && <p className="text-xs text-white/70">{note}</p>}

      {facts.length > 0 && !hidden && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          {facts.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-white/50">{label}</dt>
              <dd className="truncate text-white/85">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {!meta && <p className="text-xs text-white/50">{canTag ? t("gallery.noMetaTag") : t("gallery.noMeta")}</p>}
      {hidden && meta && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-white/60">
          <span>{t("gallery.secretHidden")}</span>
          <button type="button" className={action} onClick={() => setRevealed(true)}>
            <Eye className="h-3 w-3" />
            {t("gallery.secretReveal")}
          </button>
        </div>
      )}

      {/* Hidden, "No tags" would be wrong: there may be tags, just not shown. */}
      {!hidden && (
        <LightboxTagPanel
          sections={sections}
          onSearch={onSearch}
          onSendTag={(tag, target) => pushHandoff({ type: "tag", tag, target })}
          onSendTags={(tags, target) => pushHandoff({ type: "tags", tags, target })}
        />
      )}
    </div>
  )
}
