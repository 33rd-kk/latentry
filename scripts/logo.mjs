// The Latentry logo for the terminal, after the README banner: the name, and
// two rows of tiles going from noise to a finished gradient, which is what a
// diffusion run does. Printed by install.sh / install.ps1 and `npm start`
// (which skips it when LATENTRY_NO_LOGO is set, as the install scripts do).
//
//   node scripts/logo.mjs
//
// Each character cell shows two pixels ("▀", foreground on top, background
// below), in 24-bit colour. Without colour (NO_COLOR, a pipe, an old console)
// it prints one plain line; in a narrow terminal it leaves the tiles out.

// The name in a pixel font: 8 rows, cap height 0-5, x-height 2-5,
// descender 6-7; strokes two pixels wide.
const GLYPHS = {
  L: ['##...', '##...', '##...', '##...', '##...', '#####', '.....', '.....'],
  a: ['.....', '.....', '.####', '##.##', '##.##', '.####', '.....', '.....'],
  t: ['.##.', '.##.', '####', '.##.', '.##.', '..##', '....', '....'],
  e: ['.....', '.....', '.###.', '#####', '##...', '.####', '.....', '.....'],
  n: ['.....', '.....', '####.', '##.##', '##.##', '##.##', '.....', '.....'],
  r: ['....', '....', '####', '##..', '##..', '##..', '....', '....'],
  y: ['.....', '.....', '##.##', '##.##', '##.##', '.####', '...##', '####.'],
}
const NAME = GLYPHS.L.map((_, row) =>
  [...'Latentry'].map((letter) => GLYPHS[letter][row]).join('.')
)
const TAGLINE = 'A local web UI for the image models you already run.'
const FEATURES = 'txt2img · img2img · inpaint · pose · gallery · WD14 tags'

// Same colours and seed as scripts/make-banner.mjs.
const PALETTE = [
  ['#6d5dfc', '#f472b6'],
  ['#0ea5e9', '#a78bfa'],
]
const STEPS = 5
const TILE_W = 8 // pixels = columns
const TILE_H = 6 // pixels = 3 lines

function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t))

/** One tile as a TILE_H x TILE_W grid of colours, `t` of the way from noise to the gradient. */
function tile(t, [from, to], random) {
  const k = t * t * (3 - 2 * t)
  return Array.from({ length: TILE_H }, (_, row) =>
    Array.from({ length: TILE_W }, (_, col) => {
      const target = mix(hex(from), hex(to), (row + col) / (TILE_W + TILE_H - 2))
      const noise = [random(), random(), random()].map((v) => Math.round(v * 255))
      return mix(noise, target, k)
    })
  )
}

const fg = ([r, g, b]) => `\x1b[38;2;${r};${g};${b}m`
const bg = ([r, g, b]) => `\x1b[48;2;${r};${g};${b}m`
const RESET = '\x1b[0m'

/** Pixel rows (colour or null) as terminal lines, two pixel rows per line. */
function toLines(pixels) {
  const lines = []
  for (let row = 0; row < pixels.length; row += 2) {
    let line = ''
    for (let col = 0; col < pixels[row].length; col += 1) {
      const top = pixels[row][col]
      const bottom = pixels[row + 1]?.[col] ?? null
      if (!top && !bottom) line += `${RESET} `
      else if (top && bottom) line += `${fg(top)}${bg(bottom)}▀`
      else if (top) line += `${RESET}${fg(top)}▀`
      else line += `${RESET}${fg(bottom)}▄`
    }
    lines.push(line + RESET)
  }
  return lines
}

function logo(columns) {
  const white = [250, 250, 250]
  const name = toLines(NAME.map((row) => [...row].map((c) => (c === '#' ? white : null))))
  const width = NAME[0].length
  const text = [
    ...name,
    '',
    `\x1b[38;2;163;163;163m${TAGLINE}${RESET}`,
    `\x1b[38;2;115;115;115m${FEATURES}${RESET}`,
  ]
  const textWidth = Math.max(width, TAGLINE.length, FEATURES.length)
  const tilesWidth = STEPS * TILE_W + (STEPS - 1)
  if (columns < 2 + textWidth + 4 + tilesWidth) return text.map((line) => `  ${line}`)

  const random = rng(20261003)
  const tiles = []
  PALETTE.forEach((colours, row) => {
    const grids = Array.from({ length: STEPS }, (_, step) => tile(step / (STEPS - 1), colours, random))
    const rows = grids[0].map((_, y) => grids.flatMap((grid, i) => [...grid[y], ...(i < STEPS - 1 ? [null] : [])]))
    if (row > 0) tiles.push('')
    tiles.push(...toLines(rows))
  })
  const visible = (s) => s.replace(/\x1b\[[0-9;]*m/g, '').length
  const height = Math.max(text.length, tiles.length)
  return Array.from({ length: height }, (_, i) => {
    const left = text[i] ?? ''
    return `  ${left}${' '.repeat(textWidth - visible(left) + 4)}${tiles[i] ?? ''}`
  })
}

const out = process.stdout
const colour = out.isTTY && !process.env.NO_COLOR && (out.hasColors?.(2 ** 24) || process.platform === 'win32')
if (colour) {
  out.write(`\n${logo(out.columns || 80).join('\n')}\n\n`)
} else {
  out.write(`\nLatentry: ${TAGLINE}\n\n`)
}
