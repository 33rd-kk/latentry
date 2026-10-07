// The orders the gallery can list a folder in, and the page cursor that goes
// with each.
//
// Every order ends by comparing names, so two files never tie and a cursor
// always names one place in the list. Most orders use only what a directory
// listing already knows (time, name, size). The "meta" orders, by when the
// picture was made and by its pixel count, need each file's header read
// first; lib/gallery/folder-index.ts does that and hands the values in.
//
// Pure, so the verify script can pin it down.

export const SORT_KEYS = [
  'newest',
  'oldest',
  'name-asc',
  'name-desc',
  'size-desc',
  'created-desc',
  'created-asc',
  'pixels-desc',
  'pixels-asc',
] as const
export type SortKey = (typeof SORT_KEYS)[number]
export const DEFAULT_SORT: SortKey = 'newest'

const META_SORTS: readonly SortKey[] = ['created-desc', 'created-asc', 'pixels-desc', 'pixels-asc']

/** Whether the order needs every file's header read before the first page. */
export function isMetaSort(sort: SortKey): boolean {
  return META_SORTS.includes(sort)
}

export function isSortKey(value: unknown): value is SortKey {
  return typeof value === 'string' && (SORT_KEYS as readonly string[]).includes(value)
}

/** What a sort needs of a file. */
export interface SortableEntry {
  name: string
  mtime: number
  size: number
  /** When the picture was made (ms): its settings' time, else the file's. Meta orders only. */
  created?: number
  /** Width × height, 0 when unknown. Meta orders only. */
  pixels?: number
}

// Numeric, so "img2" comes before "img10".
const collator = new Intl.Collator(undefined, { numeric: true })

/** Names in order; names the collator calls equal fall back to their code units. */
function compareNames(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0)
}

export function compareEntries(sort: SortKey): (a: SortableEntry, b: SortableEntry) => number {
  switch (sort) {
    case 'oldest':
      return (a, b) => a.mtime - b.mtime || compareNames(a.name, b.name)
    case 'name-asc':
      return (a, b) => compareNames(a.name, b.name)
    case 'name-desc':
      return (a, b) => compareNames(b.name, a.name)
    case 'size-desc':
      return (a, b) => b.size - a.size || compareNames(a.name, b.name)
    case 'created-desc':
      return (a, b) => (b.created ?? b.mtime) - (a.created ?? a.mtime) || compareNames(a.name, b.name)
    case 'created-asc':
      return (a, b) => (a.created ?? a.mtime) - (b.created ?? b.mtime) || compareNames(a.name, b.name)
    // Pictures of unknown size go last both ways.
    case 'pixels-desc':
      return (a, b) => (b.pixels ?? 0) - (a.pixels ?? 0) || compareNames(a.name, b.name)
    case 'pixels-asc':
      return (a, b) => unknownLast(a.pixels) - unknownLast(b.pixels) || compareNames(a.name, b.name)
    case 'newest':
    default:
      return (a, b) => b.mtime - a.mtime || compareNames(a.name, b.name)
  }
}

function unknownLast(pixels: number | undefined): number {
  return pixels ? pixels : Number.MAX_SAFE_INTEGER
}

/** The number the order is by, if any: the cursor carries it. */
function sortValue(entry: SortableEntry, sort: SortKey): number | null {
  switch (sort) {
    case 'newest':
    case 'oldest':
      return entry.mtime
    case 'size-desc':
      return entry.size
    case 'created-desc':
    case 'created-asc':
      return entry.created ?? entry.mtime
    case 'pixels-desc':
    case 'pixels-asc':
      return entry.pixels ?? 0
    default:
      return null
  }
}

/**
 * Cursor = "sort:value:name" of the last item on the page, so files arriving
 * or leaving do not shift the next page. The value is empty for name orders;
 * the name comes last because it may itself contain colons.
 */
export function encodeCursor(entry: SortableEntry, sort: SortKey): string {
  return `${sort}:${sortValue(entry, sort) ?? ''}:${entry.name}`
}

function decodeCursor(cursor: string, sort: SortKey): SortableEntry | null {
  const first = cursor.indexOf(':')
  const second = first === -1 ? -1 : cursor.indexOf(':', first + 1)
  if (second === -1 || cursor.slice(0, first) !== sort) return null
  const raw = cursor.slice(first + 1, second)
  const value = raw === '' ? NaN : Number(raw)
  if (sortValue({ name: '', mtime: 0, size: 0 }, sort) !== null && !Number.isFinite(value)) return null
  return { name: cursor.slice(second + 1), mtime: value, size: value, created: value, pixels: value }
}

/**
 * Where the page after `cursor` starts in `entries` (sorted by `sort`): the
 * first entry that comes after the cursor's. -1 when nothing does. A cursor
 * that is missing, broken or from another order starts from the top.
 */
export function startIndex(entries: readonly SortableEntry[], cursor: string | null | undefined, sort: SortKey): number {
  if (!cursor) return 0
  const after = decodeCursor(cursor, sort)
  if (!after) return 0
  const compare = compareEntries(sort)
  return entries.findIndex((entry) => compare(entry, after) > 0)
}
