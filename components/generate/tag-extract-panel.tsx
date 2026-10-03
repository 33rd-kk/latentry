"use client"

import { useCallback, useMemo, useState } from "react"
import { Loader2, Plus, Tags } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"
import { TAG_GROUPS, classifyTag, tagForPrompt, type TagGroup } from "@/lib/tag-groups"
import type { SourceImage } from "./source-image-slot"

interface ExtractedTag {
  /** Already in prompt spelling (spaces, see tagForPrompt). */
  tag: string
  score: number
  group: TagGroup
}

interface TagExtractPanelProps {
  source: SourceImage
  /** Receives the picked tags, in group order, ready to append to the prompt. */
  onAdd: (tags: string[]) => void
  /** Groups that start selected: the character's look, or only the pose for a pose reference. */
  defaultGroups: ReadonlySet<TagGroup>
  /** Shown before the first extract, saying what the defaults will pick. */
  hint: string
  disabled?: boolean
}

/**
 * Reads a source image's WD14 tags (/api/gen/tag) and lets the user carry
 * the ones that make the character — hair, eyes, body, outfit — into the prompt.
 *
 * For a variation source those groups start selected and expression, pose and
 * scene start off: the point is the same character in a new picture, and this
 * picture's smile or background would pull the new one back towards the old.
 * For a pose reference it is the other way round (see POSE_GROUPS).
 */
export function TagExtractPanel({ source, onAdd, defaultGroups, hint, disabled }: TagExtractPanelProps) {
  const t = useT()
  const [tags, setTags] = useState<ExtractedTag[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Switching between variation and pose reference keeps the extracted tags
  // (no second scan) but starts the selection over from the new defaults.
  // Adjusted during render, React's pattern for state that follows a prop.
  const [selectionDefaults, setSelectionDefaults] = useState(defaultGroups)
  if (selectionDefaults !== defaultGroups) {
    setSelectionDefaults(defaultGroups)
    setSelected(new Set((tags ?? []).filter((item) => defaultGroups.has(item.group)).map((item) => item.tag)))
  }

  const extract = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/gen/tag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_base64: source.dataUrl }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !Array.isArray(data?.tags)) {
        throw new Error(data?.error ? t.server(data.error) : t("generate.requestFailed", { status: response.status }))
      }
      const extracted: ExtractedTag[] = data.tags.map((item: { name: string; score: number; category: number }) => ({
        tag: tagForPrompt(item.name),
        score: item.score,
        group: classifyTag(item.name, item.category),
      }))
      setTags(extracted)
      setSelected(new Set(extracted.filter((item) => defaultGroups.has(item.group)).map((item) => item.tag)))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("generate.unreachable"))
    } finally {
      setLoading(false)
    }
  }, [source, defaultGroups, t])

  const grouped = useMemo(() => {
    const byGroup = new Map<TagGroup, ExtractedTag[]>()
    for (const item of tags ?? []) {
      byGroup.set(item.group, [...(byGroup.get(item.group) ?? []), item])
    }
    return TAG_GROUPS.filter((group) => byGroup.has(group)).map((group) => ({ group, items: byGroup.get(group)! }))
  }, [tags])

  const toggle = useCallback((tag: string) => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }, [])

  const toggleGroup = useCallback((items: ExtractedTag[]) => {
    setSelected((previous) => {
      const next = new Set(previous)
      const allOn = items.every((item) => next.has(item.tag))
      for (const item of items) {
        if (allOn) next.delete(item.tag)
        else next.add(item.tag)
      }
      return next
    })
  }, [])

  // Group order, not click order, so the prompt reads character → hair → eyes → ...
  const picked = grouped.flatMap(({ items }) => items.filter((item) => selected.has(item.tag)).map((item) => item.tag))

  return (
    <div className="space-y-2 rounded-md border border-dashed p-2">
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          onClick={() => void extract()}
          disabled={disabled || loading}
        >
          {loading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Tags className="mr-1 h-3.5 w-3.5" />}
          {tags ? t("generate.tagsReExtract") : t("generate.tagsExtract")}
        </Button>
        {tags && (
          <Button
            type="button"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => onAdd(picked)}
            disabled={disabled || picked.length === 0}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t("generate.tagsAdd", { count: picked.length })}
          </Button>
        )}
      </div>

      {!tags && !loading && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}

      {grouped.map(({ group, items }) => (
        <div key={group} className="space-y-1">
          <button
            type="button"
            onClick={() => toggleGroup(items)}
            disabled={disabled}
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {t(`generate.tagGroup.${group}`)}
          </button>
          <div className="flex flex-wrap gap-1">
            {items.map((item) => (
              <button
                key={item.tag}
                type="button"
                onClick={() => toggle(item.tag)}
                disabled={disabled}
                title={`${Math.round(item.score * 100)}%`}
                className={cn(
                  "rounded border px-1.5 py-0.5 text-xs transition",
                  selected.has(item.tag)
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground line-through decoration-muted-foreground/40 hover:text-foreground"
                )}
              >
                {item.tag}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
