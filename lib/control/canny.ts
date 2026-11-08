// Canny edges, in plain TypeScript: no model to download, runs anywhere.
// Sobel gradients (L1 magnitude, as OpenCV's default), thinning to the
// strongest pixel across each edge, then two thresholds joined by
// hysteresis. White edges on black, as ControlNet's canny models expect.

/** OpenCV's and ControlNet's usual pair: weaker edges count only next to stronger ones. */
export const CANNY_DEFAULTS = { low: 100, high: 200 } as const

/**
 * Edges of a greyscale picture (one byte per pixel, rows top to bottom),
 * 255 on an edge and 0 elsewhere. Blur it first; this does not.
 */
export function cannyEdges(grey: Uint8Array, width: number, height: number, low: number = CANNY_DEFAULTS.low, high: number = CANNY_DEFAULTS.high): Uint8Array {
  const size = width * height
  const magnitude = new Float32Array(size)
  // 0: horizontal edge (gradient up/down), 1: 45°, 2: vertical, 3: 135°.
  const direction = new Uint8Array(size)
  const at = (x: number, y: number) => grey[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)
      const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)
      const index = y * width + x
      magnitude[index] = Math.abs(gx) + Math.abs(gy)
      // tan(22.5°) ≈ 0.4142, tan(67.5°) ≈ 2.4142, as OpenCV bins them.
      const ax = Math.abs(gx)
      const ay = Math.abs(gy)
      direction[index] = ay <= ax * 0.4142 ? 2 : ay >= ax * 2.4142 ? 0 : gx * gy > 0 ? 3 : 1
    }
  }

  // Thinning: a pixel stays only if it is the strongest across its edge.
  const strength = new Uint8Array(size) // 0 none, 1 weak, 2 strong
  const stack: number[] = []
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const index = y * width + x
      const value = magnitude[index]
      if (value <= low) continue
      let a: number
      let b: number
      switch (direction[index]) {
        case 2:
          a = magnitude[index - 1]
          b = magnitude[index + 1]
          break
        case 0:
          a = magnitude[index - width]
          b = magnitude[index + width]
          break
        case 3:
          a = magnitude[index - width - 1]
          b = magnitude[index + width + 1]
          break
        default:
          a = magnitude[index - width + 1]
          b = magnitude[index + width - 1]
      }
      // Ties go to the first of a pair, so a two-pixel-wide ridge stays one pixel wide.
      if (value < a || value <= b) continue
      if (value > high) {
        strength[index] = 2
        stack.push(index)
      } else {
        strength[index] = 1
      }
    }
  }

  // Hysteresis: weak pixels joined to a strong one, through any of 8 neighbours, become edges.
  const edges = new Uint8Array(size)
  for (const index of stack) edges[index] = 255
  while (stack.length > 0) {
    const index = stack.pop()!
    const x = index % width
    const y = (index - x) / width
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx
        const ny = y + dy
        if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const neighbour = ny * width + nx
        if (strength[neighbour] === 1 && edges[neighbour] === 0) {
          edges[neighbour] = 255
          stack.push(neighbour)
        }
      }
    }
  }
  return edges
}
