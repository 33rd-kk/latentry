// The Latentry logo for the terminal, after the README banner: the name and
// tagline, and the banner's picture in coloured cells: three tiles going from
// noise to a finished gradient (a diffusion run), an arrow, the finished
// picture on a card with its settings (two sliders), and a dashed line from
// the card back to the first tile, since every picture keeps how it was made.
// Printed by install.sh / install.ps1 and `npm start` (which skips it when
// LATENTRY_NO_LOGO is set, as the install scripts do).
//
//   node scripts/logo.mjs
//
// Each character cell shows two pixels ("▀", foreground on top, background
// below), in 24-bit colour, or the nearest of 256 where that is all the
// terminal has (macOS Terminal, TERM=xterm-256color without COLORTERM).
// Without colour (NO_COLOR, a pipe, an old console) it prints one plain line;
// in a terminal narrower than 117 columns it leaves the picture out.

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
const TAGLINE = 'Private, local image generation. Every picture remembered.'
const FEATURES = 'local · no telemetry · txt2img · img2img · inpaint · pose · gallery'

// Same gradient, accent and seed as scripts/make-banner.mjs.
const GRADIENT = ['#6d5dfc', '#f472b6']
const ACCENT = [167, 139, 250]
const KNOB = [221, 214, 254]
const MUTED = [115, 115, 115]
const CARD = [38, 38, 38]
const TRACK = [70, 70, 70]

// The picture's layout, in pixels (columns x half-lines).
const TILE_W = 7
const TILE_H = 8
const TILE_TOP = 1
const ARROW_W = 5
const CARD_W = 14
const ART_H = 16

function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t))

/** One tile as an h x w grid of colours, `t` of the way from noise to the gradient. */
function tile(w, h, t, random) {
  const [from, to] = GRADIENT.map(hex)
  const k = t * t * (3 - 2 * t)
  return Array.from({ length: h }, (_, row) =>
    Array.from({ length: w }, (_, col) => {
      const target = mix(from, to, (row + col) / (w + h - 2))
      const noise = [random(), random(), random()].map((v) => Math.round(v * 255))
      return mix(noise, target, k)
    })
  )
}

/** The banner's picture as rows of pixels (a colour, or null for none). */
function art() {
  const random = rng(20261003)
  const arrowX = 3 * (TILE_W + 1)
  const cardX = arrowX + ARROW_W + 1
  const width = cardX + CARD_W
  const pixels = Array.from({ length: ART_H }, () => Array(width).fill(null))
  const paint = (x, y, colour) => {
    if (y >= 0 && y < ART_H && x >= 0 && x < width) pixels[y][x] = colour
  }
  const blit = (grid, x, y) => grid.forEach((row, dy) => row.forEach((colour, dx) => paint(x + dx, y + dy, colour)))

  // Noise to picture, three steps.
  for (let step = 0; step < 3; step += 1) blit(tile(TILE_W, TILE_H, step / 2, random), step * (TILE_W + 1), TILE_TOP)

  // The arrow, level with the tiles' middle: a shaft, and a head two
  // pixels deep (one pixel deep reads as a plus sign at this size).
  const mid = TILE_TOP + TILE_H / 2
  const tip = arrowX + ARROW_W - 1
  for (let x = arrowX; x <= tip; x += 1) paint(x, mid, MUTED)
  for (const d of [1, 2]) {
    paint(tip - d, mid - d, MUTED)
    paint(tip - d, mid + d, MUTED)
  }

  // The card: the finished picture, then two sliders.
  for (let y = 0; y < 14; y += 1) for (let x = 0; x < CARD_W; x += 1) paint(cardX + x, y, CARD)
  blit(tile(CARD_W - 2, TILE_H, 1, random), cardX + 1, TILE_TOP)
  for (const [y, at] of [[10, 0.7], [12, 0.38]]) {
    const knob = Math.round(1 + (CARD_W - 3) * at)
    for (let x = 1; x < CARD_W - 1; x += 1) paint(cardX + x, y, x < knob ? ACCENT : TRACK)
    paint(cardX + knob, y, KNOB)
  }

  // Dashed, from under the card back up to the first tile.
  const back = Math.floor(TILE_W / 2)
  const from = cardX + 2
  const bottom = ART_H - 1
  for (let y = 14; y <= bottom; y += 1) paint(from, y, MUTED)
  for (let x = back; x <= from; x += 1) if ((from - x) % 2 === 0) paint(x, bottom, MUTED)
  for (let y = TILE_TOP + TILE_H + 1; y <= bottom; y += 1) if ((bottom - y) % 2 === 0) paint(back, y, MUTED)
  // An arrowhead pointing up at the first tile.
  const top = TILE_TOP + TILE_H + 1
  paint(back, top, MUTED)
  for (const d of [1, 2]) {
    paint(back - d, top + d, MUTED)
    paint(back + d, top + d, MUTED)
  }
  return pixels
}

const out = process.stdout
const trueColour = Boolean(out.hasColors?.(2 ** 24)) || process.platform === 'win32'

/** The nearest of xterm's 256 colours: the 6x6x6 cube or the grey ramp. */
function xterm256([r, g, b]) {
  const level = (v) => (v < 48 ? 0 : v < 115 ? 1 : Math.min(5, Math.floor((v - 35) / 40)))
  const cube = [r, g, b].map(level)
  const cubeRgb = cube.map((l) => (l === 0 ? 0 : 55 + l * 40))
  const grey = Math.max(0, Math.min(23, Math.round(((r + g + b) / 3 - 8) / 10)))
  const greyRgb = 8 + grey * 10
  const distance = (c) => (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2
  return distance(cubeRgb) <= distance([greyRgb, greyRgb, greyRgb]) ? 16 + 36 * cube[0] + 6 * cube[1] + cube[2] : 232 + grey
}
const fg = (c) => (trueColour ? `\x1b[38;2;${c[0]};${c[1]};${c[2]}m` : `\x1b[38;5;${xterm256(c)}m`)
const bg = (c) => (trueColour ? `\x1b[48;2;${c[0]};${c[1]};${c[2]}m` : `\x1b[48;5;${xterm256(c)}m`)
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
    `${fg([163, 163, 163])}${TAGLINE}${RESET}`,
    `${fg([115, 115, 115])}${FEATURES}${RESET}`,
  ]
  const textWidth = Math.max(width, TAGLINE.length, FEATURES.length)
  const picture = toLines(art())
  const pictureWidth = 3 * (TILE_W + 1) + ARROW_W + 1 + CARD_W
  if (columns < 2 + textWidth + 4 + pictureWidth) return text.map((line) => `  ${line}`)

  const visible = (s) => s.replace(/\x1b\[[0-9;]*m/g, '').length
  const height = Math.max(text.length, picture.length)
  return Array.from({ length: height }, (_, i) => {
    const left = text[i] ?? ''
    return `  ${left}${' '.repeat(textWidth - visible(left) + 4)}${picture[i] ?? ''}`
  })
}

const colour = out.isTTY && !process.env.NO_COLOR && (trueColour || Boolean(out.hasColors?.(256)))
if (colour) {
  out.write(`\n${logo(out.columns || 80).join('\n')}\n\n`)
} else {
  out.write(`\nLatentry: ${TAGLINE}\n\n`)
}
