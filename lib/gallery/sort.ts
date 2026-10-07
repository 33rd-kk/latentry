// The orders the gallery can list a folder in, and the page cursor that goes
// with each.
//
// Every order ends by comparing names, so two files never tie and a cursor
// always names one place in the list. Only what a directory listing already
// knows (time, name, size) is used here: nothing has to be read from the
// files to sort them.
//
// Pure, so the verify script can pin it down.

export const SORT_KEYS = ['newest', 'oldest', 'name-asc', 'name-desc', 'size-desc'] as const
export type SortKey = (typeof SORT_KEYS)[number]
export const DEFAULT_SORT: SortKey = 'newest'

export function isSortKey(value: unknown): value is SortKey {
  return typeof value === 'string' && (SORT_KEYS as readonly string[]).includes(value)
}

/** What a sort needs of a file. */
export interface SortableEntry {
  name: string
  mtime: number
  size: number
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
    case 'newest':
    default:
      return (a, b) => b.mtime - a.mtime || compareNames(a.name, b.name)
  }
}

/** The number the order is by, if any: the cursor carries it. */
function sortValue(entry: SortableEntry, sort: SortKey): number | null {
  if (sort === 'newest' || sort === 'oldest') return entry.mtime
  if (sort === 'size-desc') return entry.size
  return null
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
  return { name: cursor.slice(second + 1), mtime: value, size: value }
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
