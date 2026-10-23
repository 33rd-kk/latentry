// The X/Y grid: reading its axes, building its cells, and running it through
// the queue against a mock A1111 web UI. A grid waits as one run, draws its
// cells in order with nothing in between, shares one seed, can be stopped or
// made secret by its id as a whole, records each cell's place in its
// pictures, and its sheet is built from those pictures only.

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { check, done, eq } from './assert'
import { startMockA1111 } from './fixtures/mock-a1111'
import en from '../locales/en.json'
import { POST as generateRoute } from '../app/api/gen/[backend]/generate/route'
import { POST as cancelRoute } from '../app/api/gen/[backend]/cancel/route'
import { GET as jobRoute } from '../app/api/gen/[backend]/job/route'
import { POST as secretRoute } from '../app/api/gen/[backend]/job/secret/route'
import { GET as streamRoute } from '../app/api/gen/[backend]/job/stream/route'
import { POST as sheetRoute } from '../app/api/gallery/sheet/route'
import { getCurrentJob, getJob } from '../lib/diffusion/job-store'
import { getGrid, queueLength } from '../lib/diffusion/run-queue'
import { readSseFrames } from '../lib/diffusion/sse'
import {
  cellRequest,
  gridCells,
  gridErrorParts,
  gridPlace,
  joinValues,
  parseAxis,
  parseGrid,
  readGridInput,
  splitValues,
  type GridError,
} from '../lib/generate/grid'
import { LATENTRY_KEY, parseLatentryRecord, readPngText } from '../lib/image-meta'
import { saveToGallery } from '../lib/gallery/save'
import { GRID_MAX_CELLS, GRID_MAX_IMAGES, GRID_MAX_VALUES } from '../lib/limits'
import type { GenerateRequest } from '../lib/backends/types'

const ORIGIN = 'http://127.0.0.1:3000'
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) }) as never

async function until(condition: () => boolean, label: string, ms = 10_000): Promise<void> {
  const end = Date.now() + ms
  while (!condition()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

const post = (route: string, body: unknown) =>
  new Request(`${ORIGIN}/api/gen/mock/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

interface Queued {
  id: string
  position: number
  grid?: { x: { kind: string; values: string[] }; y: { kind: string; values: string[] } | null; seed: number }
}

async function generate(body: Record<string, unknown>): Promise<{ status: number; job?: string; queued?: Queued; error?: string }> {
  const response = await generateRoute(post('generate', body), params({ backend: 'mock' }))
  const json = (await response.json()) as { job?: { id: string }; queued?: Queued; error?: string }
  return { status: response.status, job: json.job?.id, queued: json.queued, error: json.error }
}

const jobNow = async () => (await (await jobRoute(new Request(`${ORIGIN}/api/gen/mock/job`), params({ backend: 'mock' }))).json()) as { job: { id: string } | null; queued: number }

function watch(id: string) {
  const events: { event: string; data: Record<string, unknown> }[] = []
  const controller = new AbortController()
  const finished = (async () => {
    const response = await streamRoute(new NextRequest(`${ORIGIN}/api/gen/mock/job/stream?id=${id}`, { signal: controller.signal }), params({ backend: 'mock' }))
    try {
      for await (const frame of readSseFrames(response.body!)) {
        events.push({ event: frame.event, data: JSON.parse(frame.data) })
        if (frame.event === 'end') break
      }
    } catch {
      // Aborted.
    }
  })()
  return { events, finished, stop: () => controller.abort() }
}

const sheet = async (body: unknown) => {
  const response = await sheetRoute(new Request(`${ORIGIN}/api/gallery/sheet`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
  return { status: response.status, json: (await response.json()) as { name?: string; error?: string } }
}

const base: GenerateRequest = {
  prompt: 'a red cat, red hat',
  negative_prompt: 'blurry',
  width: 512,
  height: 512,
  seed: 7,
  image_count: 1,
  sampler: 'Euler',
  scheduler: 'Default',
  num_inference_steps: 20,
  guidance_scale: 6,
}

function errorOf(result: ReturnType<typeof parseGrid> | ReturnType<typeof parseAxis>): GridError | null {
  return result.ok ? null : result.error
}

function pureChecks(): void {
  // ── Reading values ──
  eq(splitValues('4, 6 ,8'), ['4', '6', '8'], 'values are split on commas and trimmed')
  eq(splitValues('"red, long hair", blue'), ['red, long hair', 'blue'], 'a quoted value keeps its comma')
  eq(splitValues('<lora:a:0.5>, ""'), ['<lora:a:0.5>', ''], 'and "" is an empty value on purpose')
  eq(splitValues('a,, b,'), ['a', 'b'], 'stray commas are not values')
  eq(splitValues(joinValues(['x, y', '', 'say "hi"', 'plain'])), ['x, y', '', 'say "hi"', 'plain'], 'joinValues quotes what splitValues needs back')

  const axis = (kind: Parameters<typeof parseAxis>[0]['kind'], text: string) => parseAxis({ kind, text }, 'x')
  const values = (result: ReturnType<typeof parseAxis>) => (result.ok ? result.value.values : result.error)
  eq(values(axis('steps', '20-40:5')), ['20', '25', '30', '35', '40'], 'a range with a step')
  eq(values(axis('seed', '3-1')), ['3', '2', '1'], 'a range may run down, by 1')
  eq(values(axis('cfg', '0.3-0.5:0.1, 7')), ['0.3', '0.4', '0.5', '7'], 'decimal steps do not drift, and ranges mix with values')
  const respelled = parseAxis({ kind: 'prompt_sr', text: 'red_hair, blue_hair', shown: 'red hair, blue hair' }, 'y')
  eq(respelled.ok && [respelled.value.values, respelled.value.labels], [['red_hair', 'blue_hair'], ['red hair', 'blue hair']], 'a respelled prompt S/R runs as sent and is headed as typed')
  const mismatched = parseAxis({ kind: 'prompt_sr', text: 'a, b', shown: 'a' }, 'x')
  eq(mismatched.ok && mismatched.value.labels, ['a', 'b'], 'headings that do not match the values one for one are not used')
  if (respelled.ok) {
    const spec = { x: respelled.value, y: null }
    const [, second] = gridCells(spec)
    eq([cellRequest({ ...base, prompt: 'a red_hair cat' }, spec, second).prompt, gridPlace('g', spec, second).x.value], ['a blue_hair cat', 'blue hair'], 'the cell runs the respelled value and records it as typed')
  }
  eq(errorOf(axis('cfg', '31')), { code: 'value', axis: 'x', value: '31' }, 'a value outside the setting\'s range is refused')
  eq(errorOf(axis('steps', '1.5')), { code: 'value', axis: 'x', value: '1.5' }, 'steps are whole numbers')
  eq(errorOf(axis('steps', '20-30:0.5')), { code: 'value', axis: 'x', value: '20-30:0.5' }, 'and so is a range\'s step for them')
  eq(errorOf(axis('cfg', 'lots')), { code: 'value', axis: 'x', value: 'lots' }, 'words are not numbers')
  eq(errorOf(axis('seed', '1-100000')), { code: 'tooManyValues', axis: 'x', max: GRID_MAX_VALUES }, `a typo in a range stops at ${GRID_MAX_VALUES} values`)
  eq(errorOf(axis('sampler', ' , ')), { code: 'empty', axis: 'x' }, 'an axis needs a value')

  // ── Checking a grid against its run ──
  const grid = (x: string, y?: string, request: Partial<GenerateRequest> = {}) => {
    const [xKind, xText] = x.split('=') as [never, string]
    const input = { x: { kind: xKind, text: xText }, ...(y ? { y: { kind: y.split('=')[0] as never, text: y.split('=')[1] } } : {}) }
    return parseGrid(input, { ...base, ...request })
  }
  eq(errorOf(grid('cfg=4,6', 'cfg=8')), { code: 'sameAxis' }, 'two axes on one setting are refused')
  check(grid('prompt_sr=red,blue', 'prompt_sr=cat,dog').ok, 'but two prompt S/R axes are fine')
  eq(errorOf(grid('prompt_sr=green,blue')), { code: 'notInPrompt', axis: 'x', value: 'green' }, 'prompt S/R needs its first value in the prompt')
  check(grid('prompt_sr=blurry,sharp').ok, 'or in the negative prompt')
  eq(errorOf(grid('hr_denoise=0.3,0.5')), { code: 'noHires' }, 'hires denoise needs hires fix')
  check(grid('hr_denoise=0.3,0.5', undefined, { hr_scale: 1.5 }).ok, 'and works with it')
  eq(errorOf(grid('seed=1-9', 'steps=1-8')), { code: 'tooManyCells', max: GRID_MAX_CELLS }, `at most ${GRID_MAX_CELLS} cells`)
  eq(errorOf(grid('seed=1-9', undefined, { image_count: 16 })), { code: 'tooManyImages', max: GRID_MAX_IMAGES }, `and ${GRID_MAX_IMAGES} pictures in all`)
  eq(readGridInput({ x: { kind: 'model', text: 'a' } }), null, 'an axis Latentry does not know is not read')
  eq(readGridInput({ x: { kind: 'cfg', text: 4 } }), null, 'nor one whose values are not text')
  eq(readGridInput('cfg'), null, 'nor something that is not a grid')

  // Every message the page or server can show has an English text.
  const errors: GridError[] = [
    { code: 'empty', axis: 'x' },
    { code: 'value', axis: 'y', value: 'v' },
    { code: 'tooManyValues', axis: 'x', max: 1 },
    { code: 'sameAxis' },
    { code: 'notInPrompt', axis: 'x', value: 'v' },
    { code: 'noHires' },
    { code: 'tooManyCells', max: 1 },
    { code: 'tooManyImages', max: 1 },
  ]
  const messages = en.generate.grid.error as Record<string, string>
  check(errors.every((error) => typeof messages[gridErrorParts(error)[0].split('.').at(-1)!] === 'string'), 'every grid error has a message')
  eq(gridErrorParts({ code: 'value', axis: 'y', value: 'v' })[1], { axis: 'Y', value: 'v' }, 'naming the axis and the value')

  // ── Cells ──
  const spec = grid('cfg=4,6', 'prompt_sr=red,blue')
  if (!spec.ok) throw new Error('the grid should read')
  const cells = gridCells(spec.value)
  eq(cells.map(({ xValue, yValue }) => `${xValue}/${yValue}`), ['4/red', '6/red', '4/blue', '6/blue'], 'cells run row by row: X across, Y down')
  const last = cellRequest(base, spec.value, cells[3])
  eq([last.guidance_scale, last.prompt], [6, 'a blue cat, blue hat'], 'a cell sets its X value and replaces every place of the first Y value')
  eq([base.guidance_scale, base.prompt], [6, 'a red cat, red hat'], 'without changing the run it starts from')
}

async function main(): Promise<void> {
  pureChecks()

  const scratch = mkdtempSync(path.join(tmpdir(), 'latentry-grid-'))
  const out = path.join(scratch, 'out')
  const mock = await startMockA1111()
  writeFileSync(
    path.join(scratch, 'settings.json'),
    JSON.stringify({
      version: 1,
      backends: [{ id: 'mock', kind: 'a1111', url: mock.url, profile: 'generic' }],
      gallery: { saveDir: out, dirs: [] },
      engine: { autoStart: false },
    })
  )
  Object.assign(process.env, {
    LATENTRY_SETTINGS_FILE: path.join(scratch, 'settings.json'),
    LATENTRY_RUNTIME_DIR: path.join(scratch, 'runtime'),
    LATENTRY_ENGINE: 'off',
  })
  for (const name of ['GEN_BACKENDS', 'DIFFUSION_SERVER_URL', 'GALLERY_SAVE_DIR', 'GALLERY_DIRS', 'GALLERY_AUTO_TAG']) delete process.env[name]

  try {
    // ── A grid waits as one run and draws its cells in order ──
    mock.hold()
    const bad = await generate({ prompt: 'a cat', grid: { x: { kind: 'prompt_sr', text: 'dog, fox' } } })
    eq(bad.status, 400, 'a grid that cannot run is refused before it waits')
    check(bad.error?.includes('generate.grid.error.notInPrompt') ?? false, 'saying why')
    eq((await generate({ prompt: 'a cat', grid: { x: { kind: 'clip_skip', text: '1, 2' } } })).status, 400, 'as is one that is not a grid')

    const grid = await generate({ prompt: 'a red cat', seed: -1, grid: { x: { kind: 'cfg', text: '4, 6, 8' }, y: { kind: 'prompt_sr', text: 'red, blue' } } })
    eq(grid.status, 202, 'a grid always goes through the queue, even on a free backend')
    const seed = grid.queued?.grid?.seed ?? -1
    check(seed >= 0, 'with one seed picked for every cell')
    eq([grid.queued?.grid?.x.values, grid.queued?.grid?.y?.values], [['4', '6', '8'], ['red', 'blue']], 'and the axes as the server read them')
    await until(() => mock.received.length === 1, 'the first cell to reach the backend')
    const gridStream = watch(grid.queued!.id)

    const after = await generate({ prompt: 'after the grid' })
    eq([after.status, after.queued?.position], [202, 2], 'a run asked for meanwhile waits behind the whole grid')
    const now = await jobNow()
    eq(now.job, null, 'a grid\'s cell is not offered to other pages as a run to pick up')
    eq(now.queued, 1, 'and they count only the run that has not started: the grid is not waiting any more')
    check(!JSON.stringify(now).includes(grid.queued!.id), 'nor are they told the grid\'s id')

    mock.release()
    await gridStream.finished
    await until(() => getCurrentJob('mock')?.id === after.queued!.id && getCurrentJob('mock')?.status === 'done', 'the run behind the grid')
    const names = gridStream.events.map(({ event }) => event)
    eq(names.filter((name) => name === 'cell').length, 6, 'the grid\'s stream tells about each of its six cells')
    eq(names.filter((name) => name === 'cellEnd').length, 6, 'and when each is over')
    eq(gridStream.events.at(-1), { event: 'end', data: { status: 'done', error: null } }, 'then that the grid is done')
    eq(
      mock.received.map((body) => `${body.cfg_scale}:${body.prompt}`),
      ['4:a red cat', '6:a red cat', '8:a red cat', '4:a blue cat', '6:a blue cat', '8:a blue cat', '6:after the grid'],
      'the cells ran in order, each with its values, and nothing ran in between'
    )
    check(mock.received.slice(0, 6).every((body) => body.seed === seed), 'every cell on the same seed')
    eq(queueLength('mock'), 0, 'the queue is empty')

    // ── Each cell's pictures say where they sit ──
    await until(() => readdirSync(out).length === 7, 'the pictures to be saved')
    const files = readdirSync(out).sort()
    const records = files.map((name) => parseLatentryRecord(readPngText(readFileSync(path.join(out, name)))[LATENTRY_KEY]!)!)
    const cellRecords = records.filter((record) => record.grid)
    eq(cellRecords.length, 6, 'each of the six cells\' pictures records the grid')
    check(cellRecords.every((record) => record.grid!.id === grid.queued!.id), 'by the grid\'s id')
    const blueEight = cellRecords.find((record) => record.prompt === 'a blue cat' && record.cfg === 8)
    eq(blueEight?.grid, { id: grid.queued!.id, x: { axis: 'cfg', value: '8' }, y: { axis: 'prompt_sr', value: 'blue' } }, 'and its place in it')

    // ── The sheet ──
    const nameOf = (cfg: number, prompt: string) => files[records.findIndex((record) => record.grid && record.cfg === cfg && record.prompt === prompt)]
    const rows = [
      [nameOf(4, 'a red cat'), nameOf(6, 'a red cat'), nameOf(8, 'a red cat')],
      [nameOf(4, 'a blue cat'), nameOf(6, 'a blue cat'), null],
    ]
    const saved = await sheet({ grid: grid.queued!.id, rows })
    eq(saved.status, 200, 'the sheet is made from the cells\' saved pictures')
    const sheetRecord = parseLatentryRecord(readPngText(readFileSync(path.join(out, saved.json.name!)))[LATENTRY_KEY]!)
    eq([sheetRecord?.mode, sheetRecord?.grid?.x.value, sheetRecord?.grid?.y?.value], ['sheet', '4, 6, 8', 'red, blue'], 'and says it is the grid\'s sheet, with its headings from the pictures')
    check(saved.json.name!.endsWith('_sheet.png'), 'named as one')
    eq((await sheet({ grid: grid.queued!.id, rows, secret: true })).status, 403, 'never in secret mode')
    eq((await sheet({ grid: '00000000-0000-4000-8000-000000000000', rows })).status, 400, 'nor from pictures of another grid')
    eq((await sheet({ grid: grid.queued!.id, rows: [['../settings.json']] })).status, 400, 'nor from a name that is not a picture in the save folder')
    eq((await sheet({ grid: grid.queued!.id, rows: [[saved.json.name]] })).status, 400, 'nor from a sheet')

    // Cells on one seed finish within the same second: their names must not collide.
    const cellJob = getJob('mock', getGrid('mock', grid.queued!.id)!.grid!.jobs[0]!)!
    const image = cellJob.images[0]
    const raced = await Promise.all([0, 1, 2].map(() => saveToGallery(cellJob, { ...image }, 0)))
    eq(new Set(raced).size, 3, 'pictures saved at once with the same seed and index each get a file of their own')
    eq(readdirSync(out).length, 11, 'none overwrites another')

    // ── Stopped as a whole ──
    mock.hold()
    const stopped = await generate({ prompt: 'stop me', grid: { x: { kind: 'steps', text: '10, 20, 30' } } })
    await until(() => mock.received.length === 8, 'the first cell of the grid to stop')
    const stoppedStream = watch(stopped.queued!.id)
    eq((await cancelRoute(post('cancel', { job: stopped.queued!.id }), params({ backend: 'mock' }))).status, 200, 'a grid is stopped by its id')
    mock.release()
    await stoppedStream.finished
    eq(stoppedStream.events.at(-1)?.data.status, 'cancelled', 'its stream ends cancelled')
    await new Promise((resolve) => setTimeout(resolve, 300))
    eq(mock.received.length, 8, 'and the cells it had not started never reach the backend')
    eq(getGrid('mock', stopped.queued!.id)?.input, null, 'its request is dropped')

    // ── Made secret as a whole ──
    mock.hold()
    const blocker = await generate({ prompt: 'blocker' })
    await until(() => mock.received.length === 9, 'the run ahead of the secret grid')
    const later = await generate({ prompt: 'secret grid', grid: { x: { kind: 'cfg', text: '5, 7' } } })
    eq((await secretRoute(post('job/secret', { job: later.queued!.id }), params({ backend: 'mock' }))).status, 200, 'a waiting grid can be made secret by its id')
    eq([getGrid('mock', later.queued!.id)?.grid?.secret, getGrid('mock', later.queued!.id)?.input?.secret], [true, true], 'and every cell will run secret')
    mock.release()
    await until(() => getGrid('mock', later.queued!.id)?.state === 'started' && getCurrentJob('mock')?.status === 'done', 'the secret grid to run')
    const cellJobs = getGrid('mock', later.queued!.id)!.grid!.jobs
    check(cellJobs.every((id) => id !== null && getJob('mock', id)?.secret === true), 'its cells ran as secret runs')
    check(blocker.job !== undefined, 'the run ahead ran as usual')

    // ── A grid nobody was told about ──
    const unknown = watch('00000000-0000-4000-8000-000000000000')
    await unknown.finished
    eq(unknown.events.at(-1)?.data.status, 'gone', 'an unknown id is gone')
  } finally {
    await mock.close()
    rmSync(scratch, { recursive: true, force: true })
  }
}

main()
  .then(() => done('grid'))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
