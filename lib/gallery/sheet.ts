// An X/Y grid's sheet: its cells' pictures in one PNG, with each column's and
// row's value written above and beside them. Made only when someone asks
// (Save sheet), from pictures already in the save folder, so nothing the page
// sends is drawn: the headings come from the pictures' own records.

import sharp, { type OverlayOptions } from 'sharp'
import { parseLatentryRecord, readPngText, LATENTRY_KEY, type GridUse, type LatentryRecord } from '../image-meta'
import type { GalleryDir } from './dirs'
import { readInDir } from './fs'
import { GRID_MAX_CELLS, GRID_MAX_VALUES } from '@/lib/limits'

/** The longest side of one cell on the sheet. */
export const SHEET_CELL_EDGE = 384
const HEADER = 56
const SIDE = 200
const GAP = 8
const FONT = 20

/** Names as the save folder writes them (fileNameFor), nothing that could leave it. */
const NAME = /^[\w.-]{1,200}\.png$/i

export interface SheetLayout {
  grid: string
  /** Rows of saved file names, X across and Y down; null where a cell has no picture. */
  rows: (string | null)[][]
}

/** Reads the page's layout, untrusted: null when it is not shaped like one or is too big. */
export function readSheetLayout(body: unknown): SheetLayout | null {
  const { grid, rows } = (body ?? {}) as Record<string, unknown>
  if (typeof grid !== 'string' || !/^[0-9a-f-]{36}$/.test(grid) || !Array.isArray(rows)) return null
  if (rows.length === 0 || rows.length > GRID_MAX_VALUES) return null
  const width = Array.isArray(rows[0]) ? rows[0].length : 0
  if (width === 0 || width > GRID_MAX_VALUES || width * rows.length > GRID_MAX_CELLS) return null
  const clean: (string | null)[][] = []
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== width) return null
    if (!row.every((name) => name === null || (typeof name === 'string' && NAME.test(name)))) return null
    clean.push(row as (string | null)[])
  }
  return { grid, rows: clean }
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (char) => `&#${char.charCodeAt(0)};`)
}

/** One line of text, cut to fit, as an SVG the size of its box. */
function label(text: string, width: number, height: number, align: 'middle' | 'end' = 'middle'): Buffer {
  const max = Math.max(4, Math.floor(width / (FONT * 0.55)))
  const shown = text.length > max ? `${text.slice(0, max - 1)}…` : text
  const x = align === 'middle' ? width / 2 : width - GAP
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<text x="${x}" y="${height / 2}" font-family="sans-serif" font-size="${FONT}" fill="#111" text-anchor="${align}" dominant-baseline="middle">${escapeXml(shown)}</text>` +
      `</svg>`
  )
}

export interface Sheet {
  png: Buffer
  /** The first cell's record with the sheet's own size and every axis value, to write into the sheet. */
  record: LatentryRecord
}

/**
 * Builds the sheet from the pictures `layout` names in `dir`. Every one must
 * be a cell of `layout.grid`, by its own record; null when none are, or any
 * named picture is not.
 */
export async function buildSheet(dir: GalleryDir, layout: SheetLayout): Promise<Sheet | null> {
  const columns = layout.rows[0].length
  const cells: { x: number; y: number; bytes: Buffer; grid: GridUse }[] = []
  let first: LatentryRecord | null = null
  for (const [y, row] of layout.rows.entries()) {
    for (const [x, name] of row.entries()) {
      if (!name) continue
      const picture = await readInDir(dir, name)
      if (!picture) return null
      const text = readPngText(picture.bytes)[LATENTRY_KEY]
      const meta = text ? parseLatentryRecord(text) : null
      if (!meta?.grid || meta.grid.id !== layout.grid || meta.mode === 'sheet') return null
      first ??= JSON.parse(text!) as LatentryRecord
      cells.push({ x, y, bytes: picture.bytes, grid: meta.grid })
    }
  }
  if (!first || cells.length === 0) return null

  // Headings from the pictures themselves: each column's X value, each row's Y value.
  const xValues = Array.from({ length: columns }, (_, x) => cells.find((cell) => cell.x === x)?.grid.x.value ?? '')
  const yValues = layout.rows.map((_, y) => cells.find((cell) => cell.y === y)?.grid.y?.value ?? '')
  const hasY = first.grid?.y !== undefined
  const side = hasY ? SIDE : 0

  const scaled = await Promise.all(
    cells.map(async (cell) => ({
      ...cell,
      image: await sharp(cell.bytes)
        .resize(SHEET_CELL_EDGE, SHEET_CELL_EDGE, { fit: 'contain', background: '#ffffff' })
        .png()
        .toBuffer(),
    }))
  )
  const width = side + columns * (SHEET_CELL_EDGE + GAP) + GAP
  const height = HEADER + layout.rows.length * (SHEET_CELL_EDGE + GAP) + GAP
  const left = (x: number) => side + GAP + x * (SHEET_CELL_EDGE + GAP)
  const top = (y: number) => HEADER + GAP + y * (SHEET_CELL_EDGE + GAP)

  const layers: OverlayOptions[] = [
    ...xValues.map((value, x) => ({ input: label(value, SHEET_CELL_EDGE, HEADER), left: left(x), top: 0 })),
    ...(hasY ? yValues.map((value, y) => ({ input: label(value, SIDE, SHEET_CELL_EDGE, 'end'), left: 0, top: top(y) })) : []),
    ...scaled.map((cell) => ({ input: cell.image, left: left(cell.x), top: top(cell.y) })),
  ]
  const png = await sharp({ create: { width, height, channels: 3, background: '#ffffff' } })
    .composite(layers)
    .png()
    .toBuffer()

  const grid = first.grid!
  const record: LatentryRecord = {
    ...first,
    mode: 'sheet',
    width,
    height,
    grid: {
      id: grid.id,
      x: { axis: grid.x.axis, value: xValues.join(', ') },
      ...(grid.y ? { y: { axis: grid.y.axis, value: yValues.join(', ') } } : {}),
    },
    // A sheet is many pictures: no one LoRA list or hires pass speaks for it.
    loras: undefined,
    created: new Date().toISOString(),
  }
  return { png, record }
}
