// Face fix: the detectors' outputs read into boxes, the crop and mask around
// each face, pasting a redrawn crop back (nothing outside the mask changes),
// the run that redraws the faces one after another on any backend, its
// cancel, and the generate route refusing what it cannot do before a run
// waits. No model is downloaded: the detectors' outputs are made by hand, and
// the route is asked with no detector in its models folder.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { check, done, eq } from './assert'
import { startMockA1111 } from './fixtures/mock-a1111'
import { decodeYolo, decodeYunet, letterbox, suppress, toChw, type FaceBox } from '../lib/facefix/decode'
import { canvasOf, cropFor, maskWeights, pasteFace } from '../lib/facefix/image'
import { cancelFaceFix, faceFixAdapter, squareSide, type FaceFixPlan } from '../lib/facefix/run'
import { DETECTOR_CONFIDENCE, FACE_FIX_DEFAULTS, faceFixOptions } from '../lib/generate/facefix'
import type { BackendAdapter, BackendEvent, GenerateRequest } from '../lib/backends/types'

const near = (a: number, b: number, within = 0.01) => Math.abs(a - b) <= within

function pureChecks() {
  // ── Letterbox ──
  const wide = letterbox(1280, 640, 640)
  eq([wide.scale, wide.padX, wide.padY], [0.5, 0, 160], 'a wide picture is scaled to fit and padded top and bottom')

  // ── YuNet: one sure face at stride 8, cell (row 10, col 20) ──
  const fit = letterbox(640, 640, 640)
  const cells8 = 80 * 80
  const outputs: Record<string, Float32Array> = {
    cls_8: new Float32Array(cells8),
    obj_8: new Float32Array(cells8),
    bbox_8: new Float32Array(cells8 * 4),
    cls_16: new Float32Array(1600),
    obj_16: new Float32Array(1600),
    bbox_16: new Float32Array(1600 * 4),
    cls_32: new Float32Array(400),
    obj_32: new Float32Array(400),
    bbox_32: new Float32Array(400 * 4),
  }
  const cell = 10 * 80 + 20
  outputs.cls_8[cell] = 0.81
  outputs.obj_8[cell] = 1
  // Centre at the cell's corner plus half a cell; 4 cells (32 px) a side.
  outputs.bbox_8.set([0.5, 0.5, Math.log(4), Math.log(4)], cell * 4)
  outputs.cls_8[cell + 1] = 0.2 // too unsure
  outputs.obj_8[cell + 1] = 1
  const yunet = decodeYunet(outputs, fit, 0.6)
  eq(yunet.length, 1, 'YuNet: the sure face only')
  check(near(yunet[0].x, 20.5 * 8 - 16) && near(yunet[0].y, 10.5 * 8 - 16) && near(yunet[0].width, 32) && near(yunet[0].score, 0.9), 'YuNet: its box from the cell, offsets and log size; score sqrt(cls x obj)')

  // ── YOLO: [1, 5, N], back through a letterbox ──
  const count = 3
  const yolo = new Float32Array(5 * count)
  // Columns: a face at (320, 320) 100x120 sure, one unsure, one in the padding.
  yolo.set([320, 100, 320], 0)
  yolo.set([320, 100, 10], count)
  yolo.set([100, 20, 40], 2 * count)
  yolo.set([120, 20, 10], 3 * count)
  yolo.set([0.9, 0.1, 0.8], 4 * count)
  const padded = letterbox(1280, 640, 640) // scale 0.5, padY 160
  const anime = decodeYolo(yolo, count, padded, 0.3)
  eq(anime.length, 1, 'YOLO: the unsure box and the one left in the padding are dropped')
  check(near(anime[0].x, (320 - 50) / 0.5) && near(anime[0].y, (320 - 60 - 160) / 0.5) && near(anime[0].height, 240), 'YOLO: a box goes back to the picture\'s own pixels')

  // ── Suppression ──
  const boxes: FaceBox[] = [
    { x: 0, y: 0, width: 100, height: 100, score: 0.7 },
    { x: 5, y: 5, width: 100, height: 100, score: 0.9 },
    { x: 300, y: 0, width: 50, height: 50, score: 0.8 },
    { x: 500, y: 0, width: 50, height: 50, score: 0.6 },
  ]
  eq(suppress(boxes, 0.4, 2).map((box) => box.score), [0.9, 0.8], 'the surest of overlapping boxes, at most the number asked for')

  // ── Input tensors ──
  const rgb = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120])
  eq(Array.from(toChw(rgb, 2, 'bgr255').slice(0, 4)), [30, 60, 90, 120], 'YuNet input: the blue plane first, 0–255')
  eq(Array.from(toChw(rgb, 2, 'rgb01').slice(0, 2)).map((v) => Math.round(v * 255)), [10, 40], 'YOLO input: the red plane first, 0–1')

  // ── Options ──
  eq(faceFixOptions(null), null, 'no face fix without its options')
  eq(faceFixOptions({}), FACE_FIX_DEFAULTS, 'the defaults')
  const photo = faceFixOptions({ detector: 'photo', confidence: 5, maxFaces: 99, denoise: 0, prompt: '  a face  ' })
  eq(photo, { detector: 'photo', confidence: 0.95, maxFaces: 8, denoise: 0.05, prompt: 'a face' }, 'each option held to its range')
  eq(faceFixOptions({ detector: 'photo' })?.confidence, DETECTOR_CONFIDENCE.photo, 'each detector starts at its own confidence')
  eq(faceFixOptions({ detector: 'other' })?.detector, 'anime', 'an unknown detector is the anime one')

  // ── The crop and its mask ──
  const face = { x: 10, y: 20, width: 100, height: 120, score: 1 }
  const crop = cropFor(face, 1000, 800)
  eq([crop.left, crop.top, crop.size], [0, 0, 216], 'a face near the corner: the square moves inside the picture rather than shrinking')
  const middle = cropFor({ x: 450, y: 350, width: 100, height: 100, score: 1 }, 1000, 800)
  eq([middle.left, middle.top, middle.size], [410, 310, 180], 'in the middle: centred on the face, 1.8 times its side')
  eq(cropFor({ x: 0, y: 0, width: 400, height: 400, score: 1 }, 300, 500).size, 300, 'never larger than the picture')
  const weights = maskWeights(middle)
  const at = (x: number, y: number) => weights[y * middle.size + x]
  check(at(90, 90) === 1 && at(0, 0) === 0 && at(179, 179) === 0, 'the mask: the face redrawn, the crop\'s corners kept')
  check(at(90, 40) > 0 && at(90, 40) < 1, 'and a soft edge between')
  eq([squareSide(1024, 1024), squareSide(832, 1216), squareSide(64, 64)], [1024, 1008, 256], 'each face is drawn at about the form\'s area')
}

/** A picture: a dark left half and a light right half, 400x300. */
async function source(): Promise<string> {
  const left = await sharp({ create: { width: 200, height: 300, channels: 3, background: '#203040' } }).png().toBuffer()
  return (
    await sharp({ create: { width: 400, height: 300, channels: 3, background: '#e0d0c0' } })
      .composite([{ input: left, left: 0, top: 0 }])
      .png()
      .toBuffer()
  ).toString('base64')
}

/** A backend that redraws whatever it is sent as plain red, in two steps, and records each request. */
function fakeBackend(options: { failAt?: number; refuseAt?: number } = {}) {
  const requests: GenerateRequest[] = []
  const cancels: (string | null)[] = []
  let gate: (() => void) | null = null
  const adapter: BackendAdapter = {
    config: { id: 'fake', kind: 'a1111', url: 'http://127.0.0.1:9', profile: 'generic' },
    status: async () => {
      throw new Error('not asked')
    },
    presets: async () => ({ default: null, presets: [] }),
    cancel: async (runId) => {
      cancels.push(runId)
      gate?.()
      return { ok: true, value: { status: 'cancelling' } }
    },
    async start(request) {
      const index = requests.length
      requests.push(request)
      if (options.refuseAt === index) return { ok: false, status: 409, error: 'busy' }
      async function* events(): AsyncGenerator<BackendEvent> {
        yield { type: 'start', index: 0, total: 1, steps: 2, runId: `run-${index}` }
        yield { type: 'step', index: 0, step: 1 }
        if (options.failAt === index) {
          yield { type: 'error', message: 'out of memory' }
          return
        }
        if (cancels.length) {
          yield { type: 'cancelled' }
          return
        }
        yield { type: 'step', index: 0, step: 2 }
        const red = await sharp({ create: { width: request.width, height: request.height, channels: 3, background: '#ff0000' } }).png().toBuffer()
        yield { type: 'image', index: 0, total: 1, seed: request.seed, imageBase64: red.toString('base64'), loras: [{ name: 'ink', weight: 1 }] }
        yield { type: 'done' }
      }
      return { ok: true, value: events() }
    },
  }
  return { adapter, requests, cancels, hold: () => new Promise<void>((resolve) => (gate = resolve)) }
}

async function collect(events: AsyncIterable<BackendEvent>, onEvent?: (event: BackendEvent) => Promise<void>): Promise<BackendEvent[]> {
  const seen: BackendEvent[] = []
  for await (const event of events) {
    seen.push(event)
    await onEvent?.(event)
  }
  return seen
}

const BASE: GenerateRequest = {
  prompt: 'a portrait',
  negative_prompt: 'lowres',
  width: 512,
  height: 512,
  seed: 40,
  image_count: 1,
  sampler: 'Default',
  scheduler: 'Default',
  num_inference_steps: 20,
  guidance_scale: 6,
}

async function runChecks() {
  const picture = await source()
  const faces: FaceBox[] = [
    { x: 40, y: 60, width: 60, height: 60, score: 0.9 },
    { x: 280, y: 100, width: 50, height: 70, score: 0.8 },
  ]
  const plan: FaceFixPlan = { faces, options: { ...FACE_FIX_DEFAULTS, denoise: 0.35, prompt: 'detailed face' }, side: squareSide(512, 512) }

  // ── Every face redrawn in turn, pasted back, one picture out ──
  const backend = fakeBackend()
  const started = await faceFixAdapter(backend.adapter, plan).start({ ...BASE, init_image_base64: picture })
  if (!started.ok) throw new Error(started.error)
  const events = await collect(started.value)
  eq(backend.requests.length, 2, 'one inpaint per face')
  const first = backend.requests[0]
  eq(
    [first.prompt, first.strength, first.width, first.height, first.seed, first.image_count, typeof first.mask_base64],
    ['detailed face', 0.35, 512, 512, 40, 1, 'string'],
    'each an inpaint of its crop: the face prompt, the denoise, drawn at the form\'s area, with a mask'
  )
  eq(backend.requests[1].seed, 41, 'the next face on the next seed')
  const cropSize = (await sharp(Buffer.from(first.init_image_base64!, 'base64')).metadata()).width
  eq(cropSize, cropFor(faces[0], 400, 300).size, 'the crop is the square around the face, at the picture\'s own pixels')
  eq(
    events.filter((event) => event.type === 'start').map((event) => (event.type === 'start' ? [event.steps, event.runId] : null)),
    [
      [4, 'run-0'],
      [4, 'run-1'],
    ],
    'the page sees one run of every face\'s steps, its run id following the face being drawn'
  )
  eq(
    events.filter((event) => event.type === 'step').map((event) => (event.type === 'step' ? event.step : 0)),
    [1, 2, 2, 3, 4],
    'steps count on across the faces'
  )
  const image = events.find((event) => event.type === 'image')
  check(events.at(-1)?.type === 'done' && events.filter((event) => event.type === 'image').length === 1, 'one picture, then done')
  if (image?.type === 'image') {
    eq([image.seed, image.loras], [40, [{ name: 'ink', weight: 1 }]], 'with the run\'s seed and the LoRAs the backend applied')
    const before = await canvasOf(picture)
    const after = await canvasOf(image.imageBase64)
    eq([after.width, after.height], [400, 300], 'the picture keeps its size')
    const pixel = (canvas: typeof before, x: number, y: number) => Array.from(canvas.rgba.subarray((y * canvas.width + x) * 4, (y * canvas.width + x) * 4 + 3))
    eq(pixel(after, 70, 90), [255, 0, 0], 'a face is redrawn')
    eq(pixel(after, 305, 135), [255, 0, 0], 'and the other')
    let changedOutside = 0
    for (let y = 0; y < 300; y += 1) {
      for (let x = 0; x < 400; x += 1) {
        const insideA = cropFor(faces[0], 400, 300)
        const insideB = cropFor(faces[1], 400, 300)
        const inCrop = (c: typeof insideA) => x >= c.left && x < c.left + c.size && y >= c.top && y < c.top + c.size
        if (!inCrop(insideA) && !inCrop(insideB) && pixel(after, x, y).join() !== pixel(before, x, y).join()) changedOutside += 1
      }
    }
    eq(changedOutside, 0, 'nothing outside the faces\' crops changes')
  }

  // ── Pasting through the mask only ──
  const canvas = await canvasOf(picture)
  const crop = cropFor(faces[0], 400, 300)
  const blue = (await sharp({ create: { width: 77, height: 77, channels: 3, background: '#0000ff' } }).png().toBuffer()).toString('base64')
  await pasteFace(canvas, crop, blue)
  const corner = Array.from(canvas.rgba.subarray(((crop.top) * 400 + crop.left) * 4, ((crop.top) * 400 + crop.left) * 4 + 3))
  eq(corner, [0x20, 0x30, 0x40], 'a redrawn crop of another size is scaled back, and its corners left as they were')

  // ── A face that fails, a backend that refuses the next face ──
  const failing = fakeBackend({ failAt: 1 })
  const failed = await faceFixAdapter(failing.adapter, plan).start({ ...BASE, init_image_base64: picture })
  const failedEvents = failed.ok ? await collect(failed.value) : []
  eq(failedEvents.at(-1), { type: 'error', message: 'out of memory' }, 'a face that fails ends the run with the backend\'s words')
  check(!failedEvents.some((event) => event.type === 'image'), 'and no half-fixed picture is handed back')
  const refusing = fakeBackend({ refuseAt: 0 })
  const refused = await faceFixAdapter(refusing.adapter, plan).start({ ...BASE, init_image_base64: picture })
  check(!refused.ok && refused.status === 409, 'a backend that refuses the first face refuses the run, as for any run')
  const refusingLater = fakeBackend({ refuseAt: 1 })
  const later = await faceFixAdapter(refusingLater.adapter, plan).start({ ...BASE, init_image_base64: picture })
  eq(later.ok ? (await collect(later.value)).at(-1) : null, { type: 'error', message: 'busy' }, 'one that refuses a later face ends it with its words')

  // ── Cancel ──
  const stopping = fakeBackend()
  const going = await faceFixAdapter(stopping.adapter, plan).start({ ...BASE, init_image_base64: picture })
  if (!going.ok) throw new Error(going.error)
  const stoppedEvents = await collect(going.value, async (event) => {
    if (event.type === 'step' && event.step === 1) eq(await cancelFaceFix('fake'), { ok: true, value: { status: 'cancelling' } }, 'Cancel reaches the face fix going on that backend')
  })
  eq(stopping.cancels, ['run-0'], 'and stops the face being drawn, by its own run id')
  eq([stoppedEvents.at(-1)?.type, stopping.requests.length], ['cancelled', 1], 'the faces after it are never sent')
  eq(await cancelFaceFix('fake'), null, 'once it has ended there is no face fix to stop')

  const busy = fakeBackend()
  const one = await faceFixAdapter(busy.adapter, plan).start({ ...BASE, init_image_base64: picture })
  const two = await faceFixAdapter(busy.adapter, plan).start({ ...BASE, init_image_base64: picture })
  check(one.ok && !two.ok && two.status === 409, 'one face fix at a time on a backend')
  if (one.ok) await collect(one.value)
  const unreadable = await faceFixAdapter(busy.adapter, plan).start({ ...BASE, init_image_base64: 'bm90IGEgcGljdHVyZQ==' })
  check(!unreadable.ok && unreadable.status === 400, 'a source that is no picture is refused')
}

/** The route refuses, before the run waits, what face fix cannot do. */
async function routeChecks() {
  const scratch = mkdtempSync(path.join(tmpdir(), 'latentry-facefix-'))
  const mock = await startMockA1111()
  writeFileSync(
    path.join(scratch, 'settings.json'),
    JSON.stringify({
      version: 1,
      backends: [{ id: 'mock', kind: 'a1111', url: mock.url, profile: 'generic' }],
      gallery: { saveDir: path.join(scratch, 'out'), dirs: [] },
      engine: { autoStart: false, modelsDir: path.join(scratch, 'models') },
    })
  )
  Object.assign(process.env, {
    LATENTRY_SETTINGS_FILE: path.join(scratch, 'settings.json'),
    LATENTRY_RUNTIME_DIR: path.join(scratch, 'runtime'),
    LATENTRY_ENGINE: 'off',
  })
  for (const name of ['GEN_BACKENDS', 'DIFFUSION_SERVER_URL', 'GALLERY_SAVE_DIR', 'GALLERY_DIRS']) delete process.env[name]
  try {
    const { POST: generateRoute } = await import('../app/api/gen/[backend]/generate/route')
    const ask = async (body: Record<string, unknown>) => {
      const response = await generateRoute(
        new Request('http://127.0.0.1:3000/api/gen/mock/generate', { method: 'POST', headers: { host: 'localhost:3000', 'content-type': 'application/json' }, body: JSON.stringify(body) }),
        { params: Promise.resolve({ backend: 'mock' }) } as never
      )
      return { status: response.status, error: ((await response.json()) as { error?: string }).error ?? '' }
    }
    const picture = await source()
    const missing = await ask({ prompt: 'a portrait', init_image_base64: `data:image/png;base64,${picture}`, facefix: { detector: 'photo' } })
    eq(missing.status, 409, 'without the detector downloaded, face fix is refused before it waits')
    check(missing.error.includes('generate.facefix.noDetector') || /Setup/.test(missing.error), 'saying to download it on Setup')
    const inGrid = await ask({ prompt: 'a portrait', init_image_base64: picture, facefix: {}, grid: { x: { kind: 'cfg', text: '4, 6' } } })
    eq(inGrid.status, 400, 'face fix in an X/Y grid is refused')
    eq(mock.received.length, 0, 'and nothing reached the backend')
  } finally {
    await mock.close()
    rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}

async function main() {
  pureChecks()
  await runChecks()
  await routeChecks()
  done('facefix')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
