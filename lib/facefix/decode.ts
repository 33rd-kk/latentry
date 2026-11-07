// Face boxes from the two detectors' raw outputs. Pure: no Node, no model,
// so the verify script can run them on hand-made tensors.
//
//   YuNet (photos): a fixed 640x640 BGR input; for each stride (8, 16, 32)
//   one row per grid cell with class and objectness scores, a box as offsets
//   from the cell (log-scaled size) and five landmarks, as OpenCV's
//   FaceDetectorYN decodes it.
//   YOLOv8 (anime): an RGB input scaled to 0-1; output [1, 5, N], each
//   column a box centre, size and score in input pixels.
//
// Both inputs are the picture letterboxed: scaled to fit, then padded.

/** A face in the picture's own pixels. */
export interface FaceBox {
  x: number
  y: number
  width: number
  height: number
  score: number
}

/** How the picture was fitted into the model's square input. */
export interface Letterbox {
  /** The model's input side. */
  size: number
  /** Input pixels per picture pixel. */
  scale: number
  padX: number
  padY: number
  /** The picture's own size, to clamp boxes to. */
  width: number
  height: number
}

/** Fits a picture into a square input of `size`: scaled to fit, centred. */
export function letterbox(width: number, height: number, size: number): Letterbox {
  const scale = Math.min(size / width, size / height)
  const padX = Math.floor((size - Math.round(width * scale)) / 2)
  const padY = Math.floor((size - Math.round(height * scale)) / 2)
  return { size, scale, padX, padY, width, height }
}

/** A box in input pixels back in the picture's pixels, clamped to it; null when nothing is left. */
function toPicture(fit: Letterbox, x1: number, y1: number, x2: number, y2: number, score: number): FaceBox | null {
  const left = Math.max(0, (x1 - fit.padX) / fit.scale)
  const top = Math.max(0, (y1 - fit.padY) / fit.scale)
  const right = Math.min(fit.width, (x2 - fit.padX) / fit.scale)
  const bottom = Math.min(fit.height, (y2 - fit.padY) / fit.scale)
  if (!(right - left >= 1 && bottom - top >= 1)) return null
  return { x: left, y: top, width: right - left, height: bottom - top, score }
}

const YUNET_STRIDES = [8, 16, 32] as const

/**
 * YuNet's outputs (by name: cls_8, obj_8, bbox_8, …) to faces at or above
 * `threshold`, before non-maximum suppression.
 */
export function decodeYunet(outputs: Record<string, ArrayLike<number>>, fit: Letterbox, threshold: number): FaceBox[] {
  const faces: FaceBox[] = []
  for (const stride of YUNET_STRIDES) {
    const cls = outputs[`cls_${stride}`]
    const obj = outputs[`obj_${stride}`]
    const bbox = outputs[`bbox_${stride}`]
    if (!cls || !obj || !bbox) continue
    const cols = Math.floor(fit.size / stride)
    const cells = Math.min(cls.length, obj.length, Math.floor(bbox.length / 4))
    for (let index = 0; index < cells; index += 1) {
      const clamp = (value: number) => Math.min(1, Math.max(0, value))
      const score = Math.sqrt(clamp(cls[index]) * clamp(obj[index]))
      if (!(score >= threshold)) continue
      const row = Math.floor(index / cols)
      const col = index % cols
      const cx = (col + bbox[index * 4]) * stride
      const cy = (row + bbox[index * 4 + 1]) * stride
      const w = Math.exp(bbox[index * 4 + 2]) * stride
      const h = Math.exp(bbox[index * 4 + 3]) * stride
      const face = toPicture(fit, cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, score)
      if (face) faces.push(face)
    }
  }
  return faces
}

/** YOLOv8's [1, 5, N] output (row-major: N centres x, then y, w, h, scores) to faces at or above `threshold`. */
export function decodeYolo(output: ArrayLike<number>, count: number, fit: Letterbox, threshold: number): FaceBox[] {
  const faces: FaceBox[] = []
  for (let index = 0; index < count; index += 1) {
    const score = output[4 * count + index]
    if (!(score >= threshold)) continue
    const cx = output[index]
    const cy = output[count + index]
    const w = output[2 * count + index]
    const h = output[3 * count + index]
    const face = toPicture(fit, cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, score)
    if (face) faces.push(face)
  }
  return faces
}

function iou(a: FaceBox, b: FaceBox): number {
  const left = Math.max(a.x, b.x)
  const top = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  const overlap = Math.max(0, right - left) * Math.max(0, bottom - top)
  const union = a.width * a.height + b.width * b.height - overlap
  return union > 0 ? overlap / union : 0
}

/** Best first, dropping any box that overlaps a better one by more than `threshold`; at most `max`. */
export function suppress(faces: FaceBox[], threshold: number, max: number): FaceBox[] {
  const kept: FaceBox[] = []
  for (const face of [...faces].sort((a, b) => b.score - a.score)) {
    if (kept.length >= max) break
    if (kept.every((other) => iou(face, other) <= threshold)) kept.push(face)
  }
  return kept
}

/** CHW float input from interleaved RGB bytes: BGR 0-255 for YuNet, RGB 0-1 for YOLO. */
export function toChw(rgb: Uint8Array, size: number, layout: 'bgr255' | 'rgb01'): Float32Array {
  const plane = size * size
  const out = new Float32Array(plane * 3)
  for (let pixel = 0; pixel < plane; pixel += 1) {
    const r = rgb[pixel * 3]
    const g = rgb[pixel * 3 + 1]
    const b = rgb[pixel * 3 + 2]
    if (layout === 'bgr255') {
      out[pixel] = b
      out[plane + pixel] = g
      out[2 * plane + pixel] = r
    } else {
      out[pixel] = r / 255
      out[plane + pixel] = g / 255
      out[2 * plane + pixel] = b / 255
    }
  }
  return out
}
