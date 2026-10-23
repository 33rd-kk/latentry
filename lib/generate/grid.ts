import type { GenerateRequest } from '@/lib/backends/types'
import { HIRES_LIMITS } from '@/lib/diffusion/hires'
import { serverMessage } from '@/lib/i18n/core'
import { GRID_MAX_CELLS, GRID_MAX_IMAGES, GRID_MAX_VALUES } from '@/lib/limits'

/**
 * The X/Y grid: one run's settings, drawn again for every value on one or two
 * axes, so the pictures can be laid side by side. The page writes each axis
 * as text; the server reads it again with the same functions, so what the
 * page counted is what runs.
 *
 * Shared by the page and the server: nothing here touches Node.
 */

export const GRID_AXES = ['cfg', 'steps', 'seed', 'hr_denoise', 'sampler', 'scheduler', 'prompt_sr'] as const
export type GridAxisKind = (typeof GRID_AXES)[number]

/** An axis as the page sends it: which setting, and its values as typed. */
export interface GridAxisInput {
  kind: GridAxisKind
  text: string
  /**
   * The values as typed, when `text` is respelled for the model (prompt S/R
   * on a profile that writes tags with underscores): what the headings show.
   */
  shown?: string
}

export interface GridSpecInput {
  x: GridAxisInput
  y?: GridAxisInput
}

export interface GridAxis {
  kind: GridAxisKind
  /** Each value as the run is sent it. */
  values: string[]
  /** Each value as the headings show it: as typed, which is `values` unless it was respelled. */
  labels: string[]
}

export interface GridSpec {
  x: GridAxis
  y: GridAxis | null
}

/** Where one cell sits and what it changes; the run is the base request with this applied. */
export interface GridCell {
  index: number
  x: number
  y: number
  /** The values its run sets, as shown in the headings. */
  xValue: string
  yValue: string | null
}

/** What a picture's record says of the grid it was drawn for. */
export interface GridPlace {
  id: string
  x: { axis: GridAxisKind; value: string }
  y?: { axis: GridAxisKind; value: string }
}

export type GridError =
  | { code: 'empty'; axis: 'x' | 'y' }
  | { code: 'value'; axis: 'x' | 'y'; value: string }
  | { code: 'tooManyValues'; axis: 'x' | 'y'; max: number }
  | { code: 'sameAxis' }
  | { code: 'notInPrompt'; axis: 'x' | 'y'; value: string }
  | { code: 'noHires' }
  | { code: 'tooManyCells'; max: number }
  | { code: 'tooManyImages'; max: number }

type Parsed<T> = { ok: true; value: T } | { ok: false; error: GridError }

const NUMERIC: Partial<Record<GridAxisKind, { min: number; max: number; integer: boolean }>> = {
  cfg: { min: 0, max: 30, integer: false },
  steps: { min: 1, max: 200, integer: true },
  seed: { min: 0, max: 2 ** 32 - 1, integer: true },
  hr_denoise: { min: HIRES_LIMITS.minDenoise, max: HIRES_LIMITS.maxDenoise, integer: false },
}

export function isGridAxis(value: unknown): value is GridAxisKind {
  return typeof value === 'string' && (GRID_AXES as readonly string[]).includes(value)
}

/**
 * Splits on commas, as A1111's X/Y plot does. A value with a comma in it (a
 * prompt fragment, say) goes in double quotes; `""` inside quotes is a quote.
 */
export function splitValues(text: string): string[] {
  const values: string[] = []
  let current = ''
  let quoted = false
  let wasQuoted = false
  const end = () => {
    // A bare empty value is a stray comma; `""` is an empty value on purpose
    // (a prompt S/R that removes its text, say).
    if (wasQuoted) values.push(current)
    else if (current.trim() !== '') values.push(current.trim())
    current = ''
    wasQuoted = false
  }
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        current += '"'
        i += 1
      } else if (char === '"') quoted = false
      else current += char
    } else if (char === '"' && !wasQuoted && current.trim() === '') {
      quoted = true
      wasQuoted = true
      current = ''
    } else if (char === ',' || char === '\n') end()
    else if (!wasQuoted) current += char
  }
  end()
  return values
}

/** splitValues backwards: quotes the values that need it, so splitting gives them back. */
export function joinValues(values: string[]): string {
  return values.map((value) => (value === '' || /[",\n]/.test(value) || value.trim() !== value ? `"${value.replace(/"/g, '""')}"` : value)).join(', ')
}

const round = (value: number) => Math.round(value * 10_000) / 10_000

/** `20-40:5` → 20, 25, 30, 35, 40; `1-4` steps by 1. Null when it is not a range. */
function expandRange(value: string, integer: boolean): number[] | null {
  const match = /^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)(?:\s*:\s*(\d+(?:\.\d+)?))?$/.exec(value)
  if (!match) return null
  const from = Number(match[1])
  const to = Number(match[2])
  const step = match[3] === undefined ? 1 : Number(match[3])
  if (!(step > 0) || (integer && !Number.isInteger(step))) return null
  const direction = to >= from ? 1 : -1
  const count = Math.floor(Math.abs(to - from) / step + 1e-9) + 1
  // Stops counting well past the limit: a typo like 1-100000 must not build a huge list.
  return Array.from({ length: Math.min(count, GRID_MAX_VALUES + 1) }, (_, i) => round(from + direction * i * step))
}

/** Reads one axis's text into the values it will run, or says what is wrong with it. */
export function parseAxis(axis: GridAxisInput, which: 'x' | 'y'): Parsed<GridAxis> {
  const parts = splitValues(axis.text)
  if (parts.length === 0) return { ok: false, error: { code: 'empty', axis: which } }
  const numeric = NUMERIC[axis.kind]
  let values: string[]
  if (numeric) {
    const numbers: number[] = []
    for (const part of parts) {
      const range = expandRange(part, numeric.integer)
      const list = range ?? (/^\d+(?:\.\d+)?$/.test(part) ? [Number(part)] : null)
      if (!list) return { ok: false, error: { code: 'value', axis: which, value: part } }
      for (const value of list) {
        if (value < numeric.min || value > numeric.max || (numeric.integer && !Number.isInteger(value))) {
          return { ok: false, error: { code: 'value', axis: which, value: String(value) } }
        }
        numbers.push(value)
      }
      if (numbers.length > GRID_MAX_VALUES) break
    }
    values = numbers.map(String)
  } else {
    // Sampler and scheduler names come from the backend's own list; a prompt
    // fragment is any text. Both are kept to a sane length.
    const bad = parts.find((part) => part.length > (axis.kind === 'prompt_sr' ? 1000 : 100))
    if (bad !== undefined) return { ok: false, error: { code: 'value', axis: which, value: bad.slice(0, 40) } }
    values = parts
  }
  if (values.length > GRID_MAX_VALUES) return { ok: false, error: { code: 'tooManyValues', axis: which, max: GRID_MAX_VALUES } }
  // Headings as typed, when they match the values one for one.
  const shown = axis.shown === undefined ? null : splitValues(axis.shown)
  const labels = shown && shown.length === values.length && shown.every((label) => label.length <= 1000) ? shown : values
  return { ok: true, value: { kind: axis.kind, values, labels } }
}

/** Reads a grid the page sent, untrusted: null when it is not shaped like one. */
export function readGridInput(value: unknown): GridSpecInput | null {
  if (!value || typeof value !== 'object') return null
  const axis = (raw: unknown): GridAxisInput | null => {
    if (!raw || typeof raw !== 'object') return null
    const { kind, text, shown } = raw as Record<string, unknown>
    if (!isGridAxis(kind) || typeof text !== 'string' || text.length > 20_000) return null
    return typeof shown === 'string' && shown.length <= 20_000 ? { kind, text, shown } : { kind, text }
  }
  const { x, y } = value as Record<string, unknown>
  const xAxis = axis(x)
  if (!xAxis) return null
  if (y === undefined || y === null) return { x: xAxis }
  const yAxis = axis(y)
  return yAxis ? { x: xAxis, y: yAxis } : null
}

/**
 * Checks a grid against the run it varies: both axes read, the cells and the
 * pictures within bounds, and each prompt S/R's first value in the prompt.
 */
export function parseGrid(input: GridSpecInput, base: Pick<GenerateRequest, 'prompt' | 'negative_prompt' | 'image_count' | 'hr_scale'>): Parsed<GridSpec> {
  const x = parseAxis(input.x, 'x')
  if (!x.ok) return x
  let y: GridAxis | null = null
  if (input.y) {
    const parsed = parseAxis(input.y, 'y')
    if (!parsed.ok) return parsed
    y = parsed.value
    // Two prompt S/R axes may differ; any other setting twice would draw the same cell twice.
    if (y.kind === x.value.kind && y.kind !== 'prompt_sr') return { ok: false, error: { code: 'sameAxis' } }
  }
  for (const [which, axis] of [['x', x.value], ['y', y]] as const) {
    if (!axis) continue
    if (axis.kind === 'hr_denoise' && base.hr_scale === undefined) return { ok: false, error: { code: 'noHires' } }
    if (axis.kind === 'prompt_sr') {
      const search = axis.values[0]
      if (!base.prompt.includes(search) && !base.negative_prompt.includes(search)) {
        return { ok: false, error: { code: 'notInPrompt', axis: which, value: search.slice(0, 40) } }
      }
    }
  }
  const cells = x.value.values.length * (y?.values.length ?? 1)
  if (cells > GRID_MAX_CELLS) return { ok: false, error: { code: 'tooManyCells', max: GRID_MAX_CELLS } }
  if (cells * base.image_count > GRID_MAX_IMAGES) return { ok: false, error: { code: 'tooManyImages', max: GRID_MAX_IMAGES } }
  return { ok: true, value: { x: x.value, y } }
}

/** Every cell, row by row: the X values across, the Y values down. */
export function gridCells(spec: GridSpec): GridCell[] {
  const rows = spec.y?.values ?? [null]
  const cells: GridCell[] = []
  rows.forEach((yValue, y) => {
    spec.x.values.forEach((xValue, x) => {
      cells.push({ index: cells.length, x, y, xValue, yValue })
    })
  })
  return cells
}

function apply(request: GenerateRequest, axis: GridAxis, value: string): void {
  switch (axis.kind) {
    case 'cfg':
      request.guidance_scale = Number(value)
      return
    case 'steps':
      request.num_inference_steps = Number(value)
      return
    case 'seed':
      request.seed = Number(value)
      return
    case 'hr_denoise':
      request.hr_denoise = Number(value)
      return
    case 'sampler':
      request.sampler = value
      return
    case 'scheduler':
      request.scheduler = value
      return
    case 'prompt_sr': {
      // A1111's rule: every place the first value appears takes this one.
      const search = axis.values[0]
      request.prompt = request.prompt.split(search).join(value)
      request.negative_prompt = request.negative_prompt.split(search).join(value)
      return
    }
  }
}

/** The run one cell draws: the base request with its X (and Y) value set. The base is not changed. */
export function cellRequest(base: GenerateRequest, spec: GridSpec, cell: GridCell): GenerateRequest {
  const request = { ...base }
  apply(request, spec.x, cell.xValue)
  if (spec.y && cell.yValue !== null) apply(request, spec.y, cell.yValue)
  return request
}

/** What the cell's pictures record of the grid. */
export function gridPlace(id: string, spec: GridSpec, cell: GridCell): GridPlace {
  return {
    id,
    x: { axis: spec.x.kind, value: spec.x.labels[cell.x] ?? cell.xValue },
    ...(spec.y && cell.yValue !== null ? { y: { axis: spec.y.kind, value: spec.y.labels[cell.y] ?? cell.yValue } } : {}),
  }
}

/** The cells a grid would run and the pictures it would draw, for the page to show before it is sent. */
export function gridSize(spec: GridSpec, imageCount: number): { cells: number; images: number } {
  const cells = spec.x.values.length * (spec.y?.values.length ?? 1)
  return { cells, images: cells * imageCount }
}

/** The message for a grid that cannot run, as a key and its values, for the page's t() and the server's serverMessage(). */
export function gridErrorParts(error: GridError): [GridErrorKey, Record<string, string | number>] {
  const vars: Record<string, string | number> = {}
  if ('axis' in error) vars.axis = error.axis.toUpperCase()
  if ('value' in error) vars.value = error.value
  if ('max' in error) vars.max = error.max
  return [`generate.grid.error.${error.code}`, vars]
}

export type GridErrorKey = `generate.grid.error.${GridError['code']}`

/** gridErrorParts, as the server sends it (translated on the page). */
export function gridErrorMessage(error: GridError): string {
  return serverMessage(...gridErrorParts(error))
}
