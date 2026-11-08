// Control pictures made by Latentry: Canny edges in plain TypeScript, and the
// depth and line art models' downloads and their absence. The models
// themselves are not downloaded here; the real check runs them.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { check, done, eq } from './assert'
import { cannyEdges } from '../lib/control/canny'
import { ANNOTATOR_ENTRY, AnnotatorMissingError, annotatorFile, CONTROL_MAX_EDGE, controlPicture, fitWithin } from '../lib/control/annotators'
import { CATALOG, catalogEntry } from '../lib/engine/catalog'
import { localModelDir } from '../lib/engine/tagger-download'
import { maxBodyBytes, MAX_REQUEST_BODY_BYTES } from '../lib/limits'
import { POST as controlRoute } from '../app/api/control/route'

/** A grey picture with a white square in it, one byte per pixel. */
function square(width: number, height: number, from: number, to: number): Uint8Array {
  const grey = new Uint8Array(width * height).fill(30)
  for (let y = from; y < to; y++) for (let x = from; x < to; x++) grey[y * width + x] = 230
  return grey
}

const post = (body: unknown) => new Request('http://127.0.0.1:3000/api/control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

async function main(): Promise<void> {
  // ── Canny ──
  const edges = cannyEdges(square(40, 40, 10, 30), 40, 40)
  const on = (x: number, y: number) => edges[y * 40 + x] === 255
  check(on(20, 10) || on(20, 9), 'an edge along the square\'s top')
  check(on(10, 20) || on(9, 20), 'and its left side')
  eq([on(20, 20), on(3, 3), on(36, 36)], [false, false, false], 'nothing inside it or in the flat background')
  const across = [8, 9, 10, 11, 12].filter((y) => on(20, y)).length
  eq(across, 1, 'each edge is one pixel thick')
  eq(cannyEdges(new Uint8Array(400).fill(90), 20, 20).some((value) => value !== 0), false, 'a flat picture has no edges')
  // A faint step on its own is dropped; joined to a strong edge, it stays.
  const faint = new Uint8Array(30 * 30).fill(100)
  for (let y = 0; y < 30; y++) for (let x = 15; x < 30; x++) faint[y * 30 + x] = 130
  eq(cannyEdges(faint, 30, 30).some((value) => value !== 0), false, 'a weak edge alone is not an edge')

  eq(fitWithin(4000, 2000), { width: CONTROL_MAX_EDGE, height: CONTROL_MAX_EDGE / 2 }, 'a large picture is made at most 1024 on its longest side')
  eq(fitWithin(300, 200), { width: 300, height: 200 }, 'a small one at its own size')

  const photo = await sharp({ create: { width: 1600, height: 800, channels: 3, background: '#202020' } })
    .composite([{ input: await sharp({ create: { width: 600, height: 400, channels: 3, background: '#e0e0e0' } }).png().toBuffer(), left: 500, top: 200 }])
    .png()
    .toBuffer()
  const made = await controlPicture('canny', photo)
  const meta = await sharp(made).metadata()
  eq([meta.format, meta.width, meta.height, meta.channels], ['png', 1024, 512, 1], 'Canny gives a greyscale PNG at the picture\'s aspect, 1024 wide')
  const { data } = await sharp(made).raw().toBuffer({ resolveWithObject: true })
  const lit = data.filter((value) => value === 255).length
  check(lit > 1000 && lit < data.length * 0.02, `white edges on black (${lit} lit pixels)`)

  // ── The models: pinned, downloaded on request, missing until then ──
  const annotators = CATALOG.filter((entry) => entry.kind === 'annotator')
  eq(annotators.map((entry) => entry.id).sort(), Object.values(ANNOTATOR_ENTRY).sort(), 'one catalog entry for each model-made kind')
  for (const entry of annotators) {
    check(/^[0-9a-f]{40}$/.test(entry.revision ?? ''), `${entry.id}: pinned to a commit`)
    const files = entry.files ?? []
    check(files.length === 1 && /^[0-9a-f]{64}$/.test(entry.sha256?.[files[0]] ?? ''), `${entry.id}: one file, with its SHA-256`)
    check(entry.bytes > 1_000_000 && Boolean(entry.license) && Boolean(entry.licenseUrl), `${entry.id}: its size and license, shown before Download`)
  }

  const scratch = mkdtempSync(path.join(tmpdir(), 'latentry-control-'))
  writeFileSync(path.join(scratch, 'settings.json'), JSON.stringify({ version: 1, engine: { autoStart: false, modelsDir: path.join(scratch, 'models') } }))
  Object.assign(process.env, { LATENTRY_SETTINGS_FILE: path.join(scratch, 'settings.json'), LATENTRY_ENGINE: 'off' })
  try {
    const depthEntry = catalogEntry(ANNOTATOR_ENTRY.depth)!
    eq(path.relative(path.join(scratch, 'models'), localModelDir(depthEntry)), path.join('annotators', 'depth-anything-v2-small'), 'kept under <models>/annotators/<id>')
    eq([annotatorFile('depth'), annotatorFile('lineart')], [null, null], 'not there before Setup downloads them')
    let missing: unknown = null
    try {
      await controlPicture('depth', photo)
    } catch (error) {
      missing = error
    }
    check(missing instanceof AnnotatorMissingError && missing.kind === 'depth', 'a depth map before its model is downloaded says so')

    // ── The route ──
    eq(maxBodyBytes('/api/control'), MAX_REQUEST_BODY_BYTES, 'the route takes a picture-sized body')
    eq((await controlRoute(post({ kind: 'blur', image_base64: photo.toString('base64') }))).status, 400, 'an unknown kind is refused')
    eq((await controlRoute(post({ kind: 'canny' }))).status, 400, 'so is no picture')
    eq((await controlRoute(post({ kind: 'canny', image_base64: 'bm90IGEgcGljdHVyZQ==' }))).status, 400, 'and one that is not a picture')
    const lacking = await controlRoute(post({ kind: 'lineart', image_base64: photo.toString('base64') }))
    eq(lacking.status, 409, 'line art without its model: 409')
    check(!JSON.stringify(await lacking.json()).includes(scratch), 'and the answer names no folder')
    const answer = await controlRoute(post({ kind: 'canny', image_base64: `data:image/png;base64,${photo.toString('base64')}`, low: 50, high: 150 }))
    const body = (await answer.json()) as { image_base64: string; width: number; height: number }
    eq([answer.status, body.width, body.height], [200, 1024, 512], 'Canny through the route, from a data URL, with its thresholds')
    check(Buffer.from(body.image_base64, 'base64').subarray(1, 4).toString() === 'PNG', 'answered as a PNG')
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

main()
  .then(() => done('control'))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
