// An X/Y grid's saved pictures laid out as the grid was asked for: its X
// values across, its Y values down, each cell's pictures in it, and the
// sheet apart.
//
// Cells saved since 0.15 say their place on each axis (index of count), so
// the order is the one typed. Older cells say only their value: numbers are
// put in numeric order, other values in the order their cells were made.
// A heading no picture names (a cell that failed, or was deleted) is taken
// from the sheet when there is one.
//
// Pure, so the verify script can pin it down.

import type { GridAxisUse, GridUse } from '@/lib/image-meta'

const NUMERIC_AXES = new Set(['cfg', 'steps', 'seed', 'hr_denoise'])

export interface GridLayoutAxis {
  axis: string
  /** One heading per place; '' where none is known. */
  labels: string[]
}

export interface GridLayout<T> {
  x: GridLayoutAxis
  y: GridLayoutAxis | null
  /** [row][column] → its pictures, oldest first. */
  cells: T[][][]
  sheets: T[]
}

export interface GridLayoutItem {
  grid: GridUse | undefined
  sheet: boolean
  /** When it was made (ms), for the order inside a cell and of older cells' values. */
  created: number
}

/** The headings of one axis, from its cells' parts and the sheet's joined values. */
function axisLabels(parts: GridAxisUse[], axis: string, sheetValue: string | undefined): string[] {
  const placed: string[] = []
  for (const part of parts) {
    if (part.index !== undefined && part.count !== undefined) {
      placed.length = Math.max(placed.length, part.count)
      placed[part.index] ??= part.value
    }
  }
  const labels = Array.from({ length: placed.length }, (_, i) => placed[i] ?? '')
  // From the sheet, when it names as many values as there are places (or the
  // cells say none): it joins them with ", ", which a value may contain too.
  const fromSheet = sheetValue?.split(', ')
  if (fromSheet && (labels.length === 0 || fromSheet.length === labels.length)) {
    if (labels.length === 0) labels.push(...fromSheet)
    else fromSheet.forEach((value, i) => (labels[i] ||= value))
  }
  // Values of cells without a place, after the known ones.
  const unplaced = [...new Set(parts.filter((part) => part.index === undefined).map((part) => part.value))].filter((value) => !labels.includes(value))
  if (NUMERIC_AXES.has(axis) && unplaced.every((value) => Number.isFinite(Number(value)))) unplaced.sort((a, b) => Number(a) - Number(b))
  labels.push(...unplaced)
  return labels
}

/** Where one part sits among the headings: its index when it has one that fits, else by value. */
function placeOf(part: GridAxisUse, labels: string[]): number {
  if (part.index !== undefined && part.index < labels.length && (labels[part.index] === part.value || labels[part.index] === '')) return part.index
  return labels.indexOf(part.value)
}

/**
 * The grid of `items` (one grid's cells and sheet, as one stack holds them),
 * or null when none of them is a cell. Items that do not fit the first
 * cell's axes are left out.
 */
export function layoutGrid<T>(items: T[], info: (item: T) => GridLayoutItem): GridLayout<T> | null {
  const described = items.map((item) => ({ item, ...info(item) })).sort((a, b) => a.created - b.created)
  const sheets = described.filter((entry) => entry.sheet && entry.grid)
  const cells = described.filter((entry): entry is typeof entry & { grid: GridUse } => !entry.sheet && !!entry.grid)
  if (!cells.length) return null
  const first = cells[0].grid
  const fits = cells.filter(({ grid }) => grid.x.axis === first.x.axis && (grid.y?.axis ?? null) === (first.y?.axis ?? null))
  const sheet = sheets[0]?.grid

  const x: GridLayoutAxis = { axis: first.x.axis, labels: axisLabels(fits.map(({ grid }) => grid.x), first.x.axis, sheet?.x.value) }
  const y: GridLayoutAxis | null = first.y
    ? { axis: first.y.axis, labels: axisLabels(fits.map(({ grid }) => grid.y!), first.y.axis, sheet?.y?.value) }
    : null
  const grid: T[][][] = (y?.labels ?? ['']).map(() => x.labels.map(() => []))
  for (const entry of fits) {
    const column = placeOf(entry.grid.x, x.labels)
    const row = y && entry.grid.y ? placeOf(entry.grid.y, y.labels) : 0
    if (column >= 0 && row >= 0) grid[row][column].push(entry.item)
  }
  return { x, y, cells: grid, sheets: sheets.map((entry) => entry.item) }
}
