// Draws the README banner (docs/assets/banner-{light,dark}.png): the name on
// the left, and on the right a row of tiles going from noise to a finished
// gradient, which is what a diffusion run does. Deterministic, so re-running it
// only changes the files when this script changes.
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
  light: { bg: '#fafafa', fg: '#171717', muted: '#737373', line: '#e5e5e5', tileBg: '#f0f0f0' },
  dark: { bg: '#0a0a0a', fg: '#fafafa', muted: '#a3a3a3', line: '#262626', tileBg: '#171717' },
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

/** One tile: a grid of cells, `t` of the way from noise (0) to the gradient (1). */
function tile(x, y, size, t, colors, random) {
  const cells = 12
  const cell = size / cells
  const [from, to] = colors.map(hexToRgb)
  let out = `<g clip-path="url(#round-${Math.round(x)})">`
  for (let row = 0; row < cells; row += 1) {
    for (let col = 0; col < cells; col += 1) {
      const u = (row + col) / (2 * (cells - 1))
      const target = mix(from, to, u)
      const noise = [random() * 255, random() * 255, random() * 255].map(Math.round)
      // Ease, so the last steps look clearly "done" rather than almost.
      const k = t * t * (3 - 2 * t)
      out += `<rect x="${(x + col * cell).toFixed(2)}" y="${(y + row * cell).toFixed(2)}" width="${(cell + 0.6).toFixed(2)}" height="${(cell + 0.6).toFixed(2)}" fill="${rgb(mix(noise, target, k))}"/>`
    }
  }
  out += '</g>'
  return out
}

function banner(theme) {
  const c = THEMES[theme]
  const random = rng(20261003)
  const size = 92
  const gap = 12
  const steps = 5
  const rows = 2
  const left = W - 64 - steps * size - (steps - 1) * gap
  const top = (H - rows * size - (rows - 1) * gap) / 2

  let tiles = ''
  let clips = ''
  for (let row = 0; row < rows; row += 1) {
    for (let step = 0; step < steps; step += 1) {
      const x = left + step * (size + gap)
      const y = top + row * (size + gap)
      clips += `<clipPath id="round-${Math.round(x)}-${row}"><rect x="${x}" y="${y}" width="${size}" height="${size}" rx="12"/></clipPath>`
      tiles += tile(x, y, size, step / (steps - 1), PALETTE[row % PALETTE.length], random).replace(
        `url(#round-${Math.round(x)})`,
        `url(#round-${Math.round(x)}-${row})`
      )
      tiles += `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="12" fill="none" stroke="${c.line}"/>`
    }
  }

  const font = "'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif"
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>${clips}</defs>
  <rect width="${W}" height="${H}" fill="${c.bg}"/>
  <text x="64" y="150" font-family="${font}" font-size="76" font-weight="700" letter-spacing="-2" fill="${c.fg}">Latentry</text>
  <text x="66" y="200" font-family="${font}" font-size="24" fill="${c.muted}">A local web UI for the image models you already run.</text>
  <text x="66" y="236" font-family="${font}" font-size="18" fill="${c.muted}">txt2img · img2img · inpaint · pose · gallery · WD14 tags</text>
  ${tiles}
</svg>`
}

mkdirSync(OUT, { recursive: true })
for (const theme of Object.keys(THEMES)) {
  const svg = banner(theme)
  const png = await sharp(Buffer.from(svg), { density: 72 * SCALE }).png({ compressionLevel: 9, palette: true, quality: 95 }).toBuffer()
  writeFileSync(path.join(OUT, `banner-${theme}.png`), png)
  console.log(`docs/assets/banner-${theme}.png  ${(png.length / 1024).toFixed(0)} KB`)
}
