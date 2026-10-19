// Outpainting ("Extend" on the source image): the canvas grows by so many
// pixels on each side and the new area is drawn. The page sends the source
// and the four amounts; the server pads the source and makes the mask
// (./outpaint-image.ts), so every backend sees an ordinary inpaint.
//
// The sizes here are shared by both, with no Node or browser imports.

export interface OutpaintSides {
  left: number
  right: number
  top: number
  bottom: number
}

export const OUTPAINT_SIDES = ['left', 'right', 'top', 'bottom'] as const
/** The most one side can grow, in pixels; and the step the sliders move in. */
export const OUTPAINT_MAX_SIDE = 1024
export const OUTPAINT_STEP = 8
/** The largest canvas side: what Latentry's engine and fitToImage draw at most. */
export const OUTPAINT_MAX_EDGE = 2048
/**
 * The padded canvas is a multiple of this on both sides (the right and
 * bottom take the few extra pixels), so no backend resizes it: every
 * profile's size multiple (8 or 16) divides it.
 */
export const OUTPAINT_MULTIPLE = 16
/** How far the redrawn area reaches back into the source, so the seam is drawn too. */
export const OUTPAINT_OVERLAP = 32
/** Where the strength slider starts: the new area has nothing to keep. */
export const OUTPAINT_STRENGTH = 1

export const NO_SIDES: OutpaintSides = { left: 0, right: 0, top: 0, bottom: 0 }

const round = (value: number, multiple: number) => Math.ceil(value / multiple) * multiple

/** The canvas a source grows to, and each side's padding with the snap to OUTPAINT_MULTIPLE added. */
export function outpaintCanvas(source: { width: number; height: number }, sides: OutpaintSides): { width: number; height: number; pad: OutpaintSides } {
  const width = round(source.width + sides.left + sides.right, OUTPAINT_MULTIPLE)
  const height = round(source.height + sides.top + sides.bottom, OUTPAINT_MULTIPLE)
  return {
    width,
    height,
    pad: { ...sides, right: width - source.width - sides.left, bottom: height - source.height - sides.top },
  }
}

/** Whether a canvas stays within OUTPAINT_MAX_EDGE, and any side grows at all. */
export function outpaintFits(source: { width: number; height: number }, sides: OutpaintSides): boolean {
  const canvas = outpaintCanvas(source, sides)
  return canvas.width <= OUTPAINT_MAX_EDGE && canvas.height <= OUTPAINT_MAX_EDGE && OUTPAINT_SIDES.some((side) => sides[side] > 0)
}

/** The most `side` may grow with the others as they are, so the canvas stays within OUTPAINT_MAX_EDGE. */
export function outpaintRoom(source: { width: number; height: number }, sides: OutpaintSides, side: keyof OutpaintSides): number {
  const across = side === 'left' || side === 'right'
  const used = across ? source.width + sides.left + sides.right - sides[side] : source.height + sides.top + sides.bottom - sides[side]
  const room = Math.floor((OUTPAINT_MAX_EDGE - used) / OUTPAINT_STEP) * OUTPAINT_STEP
  return Math.max(0, Math.min(OUTPAINT_MAX_SIDE, room))
}

/** Four amounts from a request body: whole pixels, 0 to OUTPAINT_MAX_SIDE; null unless it is an object. */
export function outpaintSides(value: unknown): OutpaintSides | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const side = (raw: unknown) => (typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.min(OUTPAINT_MAX_SIDE, Math.round(raw))) : 0)
  return { left: side(record.left), right: side(record.right), top: side(record.top), bottom: side(record.bottom) }
}
