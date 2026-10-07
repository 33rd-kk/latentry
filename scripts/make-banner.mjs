// Draws the README banner (docs/assets/banner-{light,dark}.png): the name and
// tagline on the left, and on the right what Latentry does with a picture.
// Tiles go from noise to a finished gradient (a diffusion run), the result
// lands on a card with its settings (two sliders), and a dashed line leads
// from the card back to the start: every picture keeps how it was made and
// can be made again. Deterministic, so re-running it only changes the files
// when this script changes.
//
//   node scripts/make-banner.mjs

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const W = 1280
const H = 320
const SCALE = 2
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'docs', 'assets')

const THEMES = {
  light: { bg: '#fafafa', fg: '#171717', muted: '#737373', line: '#e5e5e5', panel: '#ffffff', faint: '#d4d4d4' },
  dark: { bg: '#0a0a0a', fg: '#fafafa', muted: '#a3a3a3', line: '#262626', panel: '#141414', faint: '#404040' },
}

// One finished "picture": a soft two-stop gradient each tile converges to.
const PALETTE = [
  ['#6d5dfc', '#f472b6'],
  ['#0ea5e9', '#a78bfa'],
  ['#f59e0b', '#ef4444'],
  ['#10b981', '#0ea5e9'],
]

function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t))
const rgb = ([r, g, b]) => `rgb(${r},${g},${b})`

const TAGLINE = 'Private, local image generation. Every picture remembered.'
const FEATURES = 'on your machine · no telemetry · txt2img · img2img · inpaint · pose · gallery'

/**
 * One tile, a grid of cells `t` of the way from noise (0) to the gradient
 * (1), clipped to a rounded rectangle.
 */
function tile(id, x, y, w, h, t, colors, random, line, radius = 12) {
  const cells = 12
  const [from, to] = colors.map(hexToRgb)
  // Ease, so the last steps look clearly "done" rather than almost.
  const k = t * t * (3 - 2 * t)
  let out = `<clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}"/></clipPath><g clip-path="url(#${id})">`
  for (let row = 0; row < cells; row += 1) {
    for (let col = 0; col < cells; col += 1) {
      const target = mix(from, to, (row + col) / (2 * (cells - 1)))
      const noise = [random() * 255, random() * 255, random() * 255].map(Math.round)
      out += `<rect x="${(x + (col * w) / cells).toFixed(2)}" y="${(y + (row * h) / cells).toFixed(2)}" width="${(w / cells + 0.6).toFixed(2)}" height="${(h / cells + 0.6).toFixed(2)}" fill="${rgb(mix(noise, target, k))}"/>`
    }
  }
  return `${out}</g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="none" stroke="${line}"/>`
}

function banner(theme) {
  const c = THEMES[theme]
  const random = rng(20261003)
  const colors = PALETTE[0]
  const accent = ['#a78bfa', '#8b5cf6']
  const stroke = `fill="none" stroke="${c.muted}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`

  // The card: the finished picture, and its settings as two sliders.
  const cardW = 180
  const cardH = 196
  const cardX = W - 64 - cardW
  const cardY = (H - cardH) / 2 - 12
  // The run: three tiles from noise to done, level with the card's picture.
  const size = 72
  const gap = 10
  const left = cardX - 34 - 3 * (size + gap) + 2
  const top = cardY + 12 + 58 - size / 2

  let art = ''
  for (let step = 0; step < 3; step += 1) {
    art += tile(`run-${step}`, left + step * (size + gap), top, size, size, step / 2, colors, random, c.line)
  }
  const arrowX = left + 3 * (size + gap) - 2
  art += `<path d="M${arrowX},${top + size / 2} h22 m-7,-6 l7,6 l-7,6" ${stroke}/>`
  art += `<rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="14" fill="${c.panel}" stroke="${c.line}"/>`
  art += tile('picture', cardX + 12, cardY + 12, cardW - 24, 116, 1, colors, random, c.line, 10)
  for (const [i, t] of [0.7, 0.38].entries()) {
    const y = cardY + 152 + i * 24
    const x0 = cardX + 18
    const x1 = cardX + cardW - 18
    const knob = x0 + (x1 - x0) * t
    art += `<rect x="${x0}" y="${y - 2}" width="${x1 - x0}" height="4" rx="2" fill="${c.faint}"/>`
    art += `<rect x="${x0}" y="${y - 2}" width="${knob - x0}" height="4" rx="2" fill="${accent[0]}"/>`
    art += `<circle cx="${knob}" cy="${y}" r="7" fill="${c.panel}" stroke="${accent[1]}" stroke-width="2.5"/>`
  }
  // Back from the card to the first tile.
  const back = left + size / 2
  const below = cardY + cardH + 18
  art += `<path d="M${cardX + 30},${cardY + cardH + 2} V${below - 12} q0,12 -12,12 H${back + 12} q-12,0 -12,-12 V${top + size + 12}" ${stroke} stroke-dasharray="5 6"/>`
  art += `<path d="M${back - 6},${top + size + 16} l6,-8 l6,8" ${stroke}/>`

  const font = "'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif"
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${c.bg}"/>
  <text x="64" y="150" font-family="${font}" font-size="76" font-weight="700" letter-spacing="-2" fill="${c.fg}">Latentry</text>
  <text x="66" y="200" font-family="${font}" font-size="24" fill="${c.muted}">${TAGLINE}</text>
  <text x="66" y="236" font-family="${font}" font-size="18" fill="${c.muted}">${FEATURES}</text>
  ${art}
</svg>`
}

mkdirSync(OUT, { recursive: true })
for (const theme of Object.keys(THEMES)) {
  const svg = banner(theme)
  const png = await sharp(Buffer.from(svg), { density: 72 * SCALE }).png({ compressionLevel: 9, palette: true, quality: 95 }).toBuffer()
  writeFileSync(path.join(OUT, `banner-${theme}.png`), png)
  console.log(`docs/assets/banner-${theme}.png  ${(png.length / 1024).toFixed(0)} KB`)
}
