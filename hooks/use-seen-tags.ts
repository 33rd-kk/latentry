"use client"

import { useMemo, useState } from "react"
import type { GalleryPicture } from "@/hooks/use-gallery"
import { normalizeText, searchableOf } from "@/lib/gallery/query"

interface Seen {
  dir: number | null
  /** Per picture shown: its tags, as the search matches them, and its sampler. */
  pictures: ReadonlyMap<string, { tags: string[]; sampler?: string }>
}

export interface SeenTags {
  /** Each tag of the pictures shown, with how many carry it. */
  tags: ReadonlyMap<string, number>
  samplers: string[]
  /** How many pictures they come from. */
  pictureCount: number
}

/**
 * The tags (prompt and WD14, as the search reads them) and samplers of the
 * pictures shown so far in this folder, for the search box's suggestions.
 * Kept while the search and filters change, so a narrower list does not take
 * them away; started over in another folder. Held in this page only.
 */
export function useSeenTags(dir: number | null, pictures: GalleryPicture[]): SeenTags {
  const [seen, setSeen] = useState<Seen>({ dir, pictures: new Map() })
  const base = seen.dir === dir ? seen.pictures : new Map<string, { tags: string[]; sampler?: string }>()
  const fresh = pictures.filter((picture) => !base.has(picture.name))
  if (seen.dir !== dir || fresh.length) {
    const next = new Map(base)
    for (const picture of fresh) {
      next.set(picture.name, { tags: [...searchableOf(picture.name, picture.meta).tags], sampler: picture.meta?.sampler })
    }
    setSeen({ dir, pictures: next })
  }
  return useMemo(() => {
    const tags = new Map<string, number>()
    const samplers = new Set<string>()
    for (const { tags: own, sampler } of seen.pictures.values()) {
      for (const tag of own) tags.set(tag, (tags.get(tag) ?? 0) + 1)
      if (sampler && normalizeText(sampler) !== "default") samplers.add(sampler)
    }
    return { tags, samplers: [...samplers].sort((a, b) => a.localeCompare(b)), pictureCount: seen.pictures.size }
  }, [seen])
}
