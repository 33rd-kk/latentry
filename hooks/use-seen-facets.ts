"use client"

import { useMemo, useState } from "react"
import type { GalleryPicture } from "@/hooks/use-gallery"
import type { Facets } from "@/lib/gallery/folder-index"

/**
 * The models and LoRAs met so far in this folder, for the filters until
 * the server has the whole folder's lists. Kept while filters change, so
 * choosing one does not shrink the list to it.
 */
export function useSeenFacets(dir: number | null, pictures: GalleryPicture[]): Facets {
  const pageFacets = useMemo(() => facetsIn(pictures), [pictures])
  const [seen, setSeen] = useState<{ dir: number | null; facets: Facets }>({ dir, facets: { models: [], loras: [] } })
  const seenFacets =
    seen.dir === dir
      ? { models: mergeNames(seen.facets.models, pageFacets.models), loras: mergeNames(seen.facets.loras, pageFacets.loras) }
      : pageFacets
  if (
    seen.dir !== dir ||
    seenFacets.models.length !== seen.facets.models.length ||
    seenFacets.loras.length !== seen.facets.loras.length
  ) {
    setSeen({ dir, facets: seenFacets })
  }
  return seenFacets
}

/** The models and LoRAs named in these pictures, each sorted. */
function facetsIn(pictures: GalleryPicture[]): Facets {
  const models = new Set<string>()
  const loras = new Set<string>()
  for (const picture of pictures) {
    if (picture.meta?.model) models.add(picture.meta.model)
    for (const lora of picture.meta?.loras ?? []) loras.add(lora)
  }
  const sorted = (names: Set<string>) => [...names].sort((a, b) => a.localeCompare(b))
  return { models: sorted(models), loras: sorted(loras) }
}

/** Both lists in one, sorted; `known` itself when `found` adds nothing. */
function mergeNames(known: string[], found: string[]): string[] {
  const added = found.filter((name) => !known.includes(name))
  return added.length ? [...known, ...added].sort((a, b) => a.localeCompare(b)) : known
}
