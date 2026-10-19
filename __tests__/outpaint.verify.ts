/**
 * Outpainting ("Extend"): the canvas sizes the page and the server agree on,
 * the padded source and its mask, and a run through the generate route on a
 * mock A1111 web UI, which should get an ordinary inpaint at the new size.
 *
 * Run with: npm test -- outpaint
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { check, done, eq } from './assert'
import { startMockA1111 } from './fixtures/mock-a1111'
import { NO_SIDES, outpaintCanvas, outpaintFits, outpaintRoom, outpaintSides, OUTPAINT_MAX_EDGE } from '../lib/generate/outpaint'
import { prepareOutpaint } from '../lib/generate/outpaint-image'
import { LATENTRY_KEY, readPngText } from '../lib/image-meta'

const ORIGIN = 'http://127.0.0.1:3000'

/** Alpha at (x, y) of a base64 PNG. */
async function alphaAt(base64: string, points: [number, number][]): Promise<number[]> {
  const { data, info } = await sharp(Buffer.from(base64, 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return points.map(([x, y]) => data[(y * info.width + x) * info.channels + 3])
}

async function main(): Promise<void> {
  sharp.cache(false)
  // ── Sizes ──
  const source = { width: 600, height: 400 }
  eq(outpaintCanvas(source, { left: 100, right: 100, top: 0, bottom: 0 }), { width: 800, height: 400, pad: { left: 100, right: 100, top: 0, bottom: 0 } }, 'the canvas is the source plus each side')
  eq(outpaintCanvas({ width: 601, height: 399 }, { left: 8, right: 0, top: 0, bottom: 0 }), { width: 624, height: 400, pad: { left: 8, right: 15, top: 0, bottom: 1 } }, 'rounded up to a multiple of 16 on the right and bottom')
  eq([outpaintFits(source, NO_SIDES), outpaintFits(source, { ...NO_SIDES, top: 8 })], [false, true], 'something has to grow')
  eq(outpaintFits({ width: 2000, height: 400 }, { ...NO_SIDES, left: 64 }), false, `and no side may pass ${OUTPAINT_MAX_EDGE}`)
  eq(outpaintRoom({ width: 2000, height: 400 }, NO_SIDES, 'left'), 48, 'a side has only the room left to the cap')
  eq(outpaintRoom(source, NO_SIDES, 'top'), 1024, 'and at most 1024')
  eq(outpaintSides({ left: 12.6, right: -5, top: 5000, bottom: 'x' }), { left: 13, right: 0, top: 1024, bottom: 0 }, 'amounts from a request are whole pixels, 0 to 1024')
  eq([outpaintSides(null), outpaintSides([1, 2])], [null, null], 'and only from an object')

  // ── The padded source and its mask ──
  const picture = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#204080' } }).png().toBuffer()
  const prepared = await prepareOutpaint(`data:image/png;base64,${picture.toString('base64')}`, { left: 100, right: 0, top: 0, bottom: 48 })
  eq([prepared?.width, prepared?.height], [704, 448], 'the canvas is padded to the new size')
  const padded = await sharp(Buffer.from(prepared!.image, 'base64')).raw().toBuffer({ resolveWithObject: true })
  eq([padded.info.width, padded.info.height], [704, 448], 'and so is the picture')
  eq([...padded.data.subarray(0, 3)], [0x20, 0x40, 0x80], 'its new area starts from the source\'s edge colours')
  eq(
    // The right side grows only by the 4 pixels that round 700 up to 704, and is drawn like any other.
    await alphaAt(prepared!.mask, [[0, 0], [99, 200], [100 + 31, 200], [100 + 32, 200], [600, 200], [700 - 32, 200], [703, 200], [400, 399 - 32], [400, 400 - 32], [400, 447]]),
    [255, 255, 255, 0, 0, 255, 255, 0, 255, 255],
    'the mask covers the new area and 32 pixels of the source along each side that grew, and nothing else'
  )
  eq(await prepareOutpaint(picture.toString('base64'), NO_SIDES), null, 'nothing to grow is refused')
  eq(await prepareOutpaint(picture.toString('base64'), { ...NO_SIDES, left: 1024, right: 1024 }), null, 'so is a canvas over the cap')
  eq(await prepareOutpaint('not a picture', { ...NO_SIDES, left: 8 }), null, 'and a source that cannot be read')

  // ── Through the generate route ──
  const scratch = mkdtempSync(path.join(tmpdir(), 'latentry-outpaint-'))
  const saveDir = path.join(scratch, 'out')
  const mock = await startMockA1111()
  writeFileSync(
    path.join(scratch, 'settings.json'),
    JSON.stringify({ version: 1, backends: [{ id: 'mock', kind: 'a1111', url: mock.url, profile: 'sdxl' }], gallery: { saveDir, dirs: [] }, engine: { autoStart: false } })
  )
  Object.assign(process.env, { LATENTRY_SETTINGS_FILE: path.join(scratch, 'settings.json'), LATENTRY_RUNTIME_DIR: path.join(scratch, 'runtime'), LATENTRY_ENGINE: 'off' })
  for (const name of ['GEN_BACKENDS', 'DIFFUSION_SERVER_URL', 'GALLERY_SAVE_DIR', 'GALLERY_DIRS', 'GALLERY_AUTO_TAG']) delete process.env[name]
  try {
    const { POST: generateRoute } = await import('../app/api/gen/[backend]/generate/route')
    const { getJob } = await import('../lib/diffusion/job-store')
    const generate = (body: unknown) =>
      generateRoute(
        new Request(`${ORIGIN}/api/gen/mock/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
        { params: Promise.resolve({ backend: 'mock' }) } as never
      )
    const base = { prompt: 'a lighthouse, wide view', width: 1024, height: 1024, init_image_base64: picture.toString('base64'), strength: 1 }
    const refused = await generate({ ...base, outpaint: NO_SIDES })
    eq(refused.status, 400, 'a run with nothing to extend is refused')
    const started = await generate({ ...base, outpaint: { left: 100, right: 0, top: 0, bottom: 48 }, pose_image_base64: picture.toString('base64'), mask_base64: picture.toString('base64') })
    eq(started.status, 200, 'an extend run starts')
    const jobId = ((await started.json()) as { job?: { id?: string } }).job?.id ?? ''
    const until = Date.now() + 10_000
    while (!(getJob('mock', jobId)?.status === 'done' && getJob('mock', jobId)?.pendingSaves === 0) && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 20))
    const sent = mock.received[0]
    eq([sent.width, sent.height, sent.denoising_strength], [704, 448, 1], 'the web UI is asked for the new canvas, at full strength')
    check(Array.isArray(sent.init_images) && typeof sent.mask === 'string', 'as an inpaint, with a picture and a mask')
    const [maskTop] = await alphaAt(String(sent.mask), [[0, 0]])
    check(maskTop === 255, 'whose mask covers the new area')
    eq(sent.alwayson_scripts, undefined, 'and no pose rides along')
    const saved = readdirSync(saveDir)
    eq(saved.length, 1, 'the picture is saved')
    const record = JSON.parse(readPngText(readFileSync(path.join(saveDir, saved[0])))[LATENTRY_KEY] ?? '{}')
    eq(record.mode, 'outpaint', 'and its record says it was extended')
  } finally {
    await mock.close()
    rmSync(scratch, { recursive: true, force: true })
  }
}

main()
  .then(() => done('outpaint'))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
