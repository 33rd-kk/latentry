// What the gallery is asked to show: the search box, the order, and the
// filters. Written into the request's query string by the page and read back
// by the API, both through here, so the two cannot disagree.
//
// Filters come in two kinds. Cheap ones (age, file type) need only the
// directory listing and are applied before any file is opened. The rest need
// the picture's size or settings, read as the page is scanned.
//
// Pure, so the verify script can pin it down.

import { DEFAULT_SORT, isSortKey, type SortKey } from './sort'
import type { ImageMeta } from './png-meta'

export const SINCE = ['day', 'week', 'month'] as const
export const FORMATS = ['png', 'webp', 'jpg'] as const
export const ORIENTATIONS = ['portrait', 'landscape', 'square'] as const
export const RESOLUTIONS = ['small', 'standard', 'large'] as const
export const SOURCES = ['latentry', 'a1111', 'comfyui', 'none'] as const

export type Since = (typeof SINCE)[number]
export type Format = (typeof FORMATS)[number]
export type Orientation = (typeof ORIENTATIONS)[number]
export type Resolution = (typeof RESOLUTIONS)[number]
export type Source = (typeof SOURCES)[number]

export interface GalleryQuery {
  /** The search box: comma-separated terms, quoted for an exact tag (see ./query.ts). */
  q?: string
  backend?: string
  profile?: string
  sort?: SortKey
  /** Changed within the last day, week or month. */
  since?: Since
  /** Any of these file types; none listed means every type. */
  formats?: Format[]
  orientation?: Orientation
  resolution?: Resolution
  model?: string
  /** Which tool wrote the settings; "none" for a picture without any. */
  source?: Source
  /** Only pictures without WD14 tags. */
  untagged?: boolean
}

const SINCE_MS: Record<Since, number> = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
}

// Resolution bands around SD's megapixel, 1024 × 1024: SD 1.5 sizes fall
// below the first, SDXL-class sizes (832 × 1216 and the like) between, and
// upscaled pictures above the second.
const MEGAPIXEL = 1024 * 1024
const SMALL_BELOW = 0.75 * MEGAPIXEL
const LARGE_FROM = 1.5 * MEGAPIXEL

/** Width / height within this band counts as square. */
const SQUARE_MIN = 0.95
const SQUARE_MAX = 1.05

// Free-text values are names of things, never long; a longer one is cut.
const MAX_TEXT = 200
const MAX_QUERY = 2000

function oneOf<T extends string>(allowed: readonly T[], value: string | null): T | undefined {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : undefined
}

function text(value: string | null, max = MAX_TEXT): string | undefined {
  const trimmed = value?.trim().slice(0, max)
  return trimmed || undefined
}

/**
 * The query as URL parameters, leaving out what is unset or default. Values
 * go in a fixed order, so equal queries give equal strings (the page keys its
 * list on this).
 */
export function toParams(query: GalleryQuery): URLSearchParams {
  const params = new URLSearchParams()
  const set = (key: string, value: string | undefined) => {
    if (value) params.set(key, value)
  }
  set('q', text(query.q ?? null, MAX_QUERY))
  set('backend', text(query.backend ?? null))
  set('profile', text(query.profile ?? null))
  if (query.sort && query.sort !== DEFAULT_SORT) set('sort', query.sort)
  set('since', query.since)
  const formats = FORMATS.filter((format) => query.formats?.includes(format))
  if (formats.length && formats.length < FORMATS.length) set('formats', formats.join(','))
  set('orientation', query.orientation)
  set('resolution', query.resolution)
  set('model', text(query.model ?? null))
  set('source', query.source)
  if (query.untagged) set('untagged', '1')
  return params
}

/** The query from URL parameters. Unknown values are dropped, not guessed at. */
export function fromParams(params: URLSearchParams): GalleryQuery {
  const sort = params.get('sort')
  const formats = FORMATS.filter((format) => (params.get('formats') ?? '').split(',').includes(format))
  return {
    q: text(params.get('q'), MAX_QUERY),
    backend: text(params.get('backend')),
    profile: text(params.get('profile')),
    sort: isSortKey(sort) ? sort : DEFAULT_SORT,
    since: oneOf(SINCE, params.get('since')),
    formats: formats.length && formats.length < FORMATS.length ? formats : undefined,
    orientation: oneOf(ORIENTATIONS, params.get('orientation')),
    resolution: oneOf(RESOLUTIONS, params.get('resolution')),
    model: text(params.get('model')),
    source: oneOf(SOURCES, params.get('source')),
    untagged: params.get('untagged') === '1' || undefined,
  }
}

/** How many filters are set, for the button that opens them. The search and the order do not count. */
export function activeFilterCount(query: GalleryQuery): number {
  const formats = query.formats?.length ?? 0
  return [
    query.backend,
    query.profile,
    query.since,
    formats > 0 && formats < FORMATS.length,
    query.orientation,
    query.resolution,
    query.model,
    query.source,
    query.untagged,
  ].filter(Boolean).length
}

/** Whether a picture's settings or size are needed to apply the query. */
export function needsMeta(query: GalleryQuery): boolean {
  return Boolean(
    query.backend || query.profile || query.orientation || query.resolution || query.model || query.source || query.untagged
  )
}

export function formatOf(name: string): Format | null {
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  if (extension === 'jpeg') return 'jpg'
  return (FORMATS as readonly string[]).includes(extension) ? (extension as Format) : null
}

/** The filters a directory listing can answer: age and file type. */
export function matchesCheap(entry: { name: string; mtime: number }, query: GalleryQuery, now: number): boolean {
  if (query.since && entry.mtime < now - SINCE_MS[query.since]) return false
  if (query.formats?.length) {
    const format = formatOf(entry.name)
    if (!format || !query.formats.includes(format)) return false
  }
  return true
}

export function orientationOf(width: number | null, height: number | null): Orientation | null {
  if (!width || !height) return null
  const ratio = width / height
  if (ratio < SQUARE_MIN) return 'portrait'
  if (ratio > SQUARE_MAX) return 'landscape'
  return 'square'
}

export function resolutionOf(width: number | null, height: number | null): Resolution | null {
  if (!width || !height) return null
  const pixels = width * height
  if (pixels < SMALL_BELOW) return 'small'
  if (pixels < LARGE_FROM) return 'standard'
  return 'large'
}

export function sourceOf(meta: ImageMeta | null): Source {
  return meta && meta.source !== 'unknown' ? meta.source : 'none'
}

/**
 * The filters that need the picture: its size and its settings. A picture
 * whose size is unknown does not match a size filter.
 */
export function matchesMeta(
  item: { width: number | null; height: number | null; meta: ImageMeta | null },
  query: GalleryQuery
): boolean {
  const { meta } = item
  if (query.backend && meta?.backend !== query.backend) return false
  if (query.profile && meta?.profile !== query.profile) return false
  if (query.orientation && orientationOf(item.width, item.height) !== query.orientation) return false
  if (query.resolution && resolutionOf(item.width, item.height) !== query.resolution) return false
  if (query.model && meta?.model !== query.model) return false
  if (query.source && sourceOf(meta) !== query.source) return false
  if (query.untagged && meta?.tags?.length) return false
  return true
}
