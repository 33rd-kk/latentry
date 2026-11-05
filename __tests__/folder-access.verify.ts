/**
 * What paired devices see of this machine's pictures: only the gallery
 * folders shared with them (a hidden one answers as a missing one would, on
 * every route that takes a folder), and only the runs they started; their
 * runs go to their own save folder when one is set. This machine and owner
 * devices see everything. Real device cookies, temp folders.
 *
 * Run with: npm test -- folder-access
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { NextRequest } from 'next/server'
import { check, done, eq } from './assert'
import type { GenerateRequest } from '../lib/backends/types'

const scratch = mkdtempSync(path.join(tmpdir(), 'latentry-folder-access-'))
const folders = { save: path.join(scratch, 'save'), comfy: path.join(scratch, 'comfy'), shown: path.join(scratch, 'shown'), phones: path.join(scratch, 'phones') }
for (const folder of Object.values(folders)) mkdirSync(folder)
Object.assign(process.env, { LATENTRY_SETTINGS_FILE: path.join(scratch, 'settings.json'), LATENTRY_ENGINE: 'off' })
for (const name of ['LATENTRY_PAIRING', 'SETTINGS_EDIT', 'GALLERY_SAVE_DIR', 'GALLERY_DIRS']) delete process.env[name]
writeFileSync(
  process.env.LATENTRY_SETTINGS_FILE!,
  JSON.stringify({
    version: 1,
    engine: { autoStart: false },
    backends: [{ id: 'mock', kind: 'a1111', url: 'http://127.0.0.1:9/', profile: 'generic' }],
    gallery: { saveDir: folders.save, dirs: [folders.comfy, folders.shown], pairedSaveDir: folders.phones, shared: [folders.shown, folders.phones] },
  })
)

const ORIGIN = 'http://192.168.1.20:3000'
const GRID = '0b5f4c1e-3f6a-4d7e-9a2b-1c3d5e7f9a0b'

async function main(): Promise<void> {
  const { issueDevice } = await import('../lib/security/pairing')
  const { DEVICE_COOKIE } = await import('../lib/security/pairing')
  const { getGalleryDirs, getSaveDir, parseGalleryDirs } = await import('../lib/gallery/dirs')
  const { maySeeRun, viewerOf } = await import('../lib/security/viewer')
  const { startJob } = await import('../lib/diffusion/job-store')
  const { saveToGallery } = await import('../lib/gallery/save')

  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#345' } }).png().toBuffer()
  for (const folder of Object.values(folders)) writeFileSync(path.join(folder, 'pic.png'), png)

  // ── Who is asking ──
  const local = { host: 'localhost:3000' }
  const lan = { host: '192.168.1.20:3000', 'x-forwarded-for': '192.168.1.30' }
  const phoneCookie = issueDevice(Date.now(), process.env, 'Phone')
  const otherCookie = issueDevice(Date.now(), process.env, 'Tablet')
  const ownerCookie = issueDevice(Date.now(), process.env, 'Laptop', true)
  const as = (value: string) => ({ ...lan, cookie: `${DEVICE_COOKIE}=${value}` })
  const phone = as(phoneCookie.value)
  const other = as(otherCookie.value)
  const owner = as(ownerCookie.value)
  const viewer = (headers: Record<string, string>) => viewerOf(new Headers(headers))
  eq(
    [viewer(local), viewer(owner), viewer(phone), viewer(lan)],
    [{ all: true, device: null }, { all: true, device: null }, { all: false, device: phoneCookie.device.id }, { all: false, device: null }],
    'this machine and an owner device see all; a paired device is itself; an unpaired client is nobody in particular'
  )
  process.env.SETTINGS_EDIT = 'off'
  eq(viewer(local).all, true, 'SETTINGS_EDIT=off does not hide this machine its own folders')
  process.env.SETTINGS_EDIT = 'lan'
  eq(viewer(phone).all, true, 'SETTINGS_EDIT=lan lets every client see all, as it lets them change everything')
  delete process.env.SETTINGS_EDIT
  const runBy = (headers: Record<string, string>) => viewer(headers)
  eq(
    [maySeeRun(viewer(local), runBy(phone)), maySeeRun(viewer(phone), runBy(phone)), maySeeRun(viewer(other), runBy(phone)), maySeeRun(viewer(phone), runBy(local)), maySeeRun(viewer(phone), undefined)],
    [true, true, false, false, false],
    "a run is seen by this machine and by the device that started it, not by another device; a paired device never sees this machine's"
  )

  // ── The folders ──
  const dirs = getGalleryDirs()
  eq(
    dirs.map(({ index, role, writable, shared }) => ({ index, role, writable, shared })),
    [
      { index: 0, role: 'save', writable: true, shared: false },
      { index: 1, role: 'read', writable: false, shared: false },
      { index: 2, role: 'read', writable: false, shared: true },
      { index: 3, role: 'pairedSave', writable: true, shared: true },
    ],
    "the save folder first, the paired devices' one last (setting it moves no other), each shared or not as set"
  )
  eq(
    parseGalleryDirs({ GALLERY_SAVE_DIR: folders.save, GALLERY_DIRS: folders.comfy }).map(({ shared }) => shared),
    [false, false],
    'without a choice, no folder is shared: an upgrade hides every folder from paired devices'
  )
  eq([getSaveDir()?.path, getSaveDir(process.env, true)?.path], [folders.save, folders.phones], "a paired device's runs go to its own save folder")
  eq(parseGalleryDirs({ GALLERY_SAVE_DIR: folders.save }).find((dir) => dir.role === 'pairedSave'), undefined, 'none unless one is set')

  // ── Every route that takes a folder ──
  const { GET: listRoute } = await import('../app/api/gallery/route')
  const { GET: pictureRoute } = await import('../app/api/gallery/[dir]/[name]/route')
  const { PUT: ratingRoute } = await import('../app/api/gallery/[dir]/[name]/rating/route')
  const { POST: tagsRoute } = await import('../app/api/gallery/[dir]/[name]/tags/route')
  const { POST: autotagRoute } = await import('../app/api/gallery/[dir]/autotag/route')
  const { POST: downloadRoute } = await import('../app/api/gallery/download/route')
  const { POST: sheetRoute } = await import('../app/api/gallery/sheet/route')
  const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) }) as never
  const json = (headers: Record<string, string>, body: unknown) => ({ method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) })

  const listed = async (headers: Record<string, string>) =>
    ((await (await listRoute(new NextRequest(`${ORIGIN}/api/gallery`, { headers }))).json()) as { dirs: { index: number }[] }).dirs.map((dir) => dir.index)
  eq(await listed(local), [0, 1, 2, 3], 'this machine is listed every folder')
  eq(await listed(owner), [0, 1, 2, 3], 'so is an owner device')
  eq(await listed(phone), [2, 3], 'a paired device only the shared ones, by their own indexes')

  // What a request gets, status and body, so a hidden folder can be compared with one that does not exist.
  const answer = async (response: Response) => `${response.status} ${await response.text()}`
  const routes: [string, (dir: string, headers: Record<string, string>) => Promise<Response>][] = [
    ['a page of the folder', (dir, headers) => listRoute(new NextRequest(`${ORIGIN}/api/gallery?dir=${dir}`, { headers }))],
    ['its models and LoRAs', (dir, headers) => listRoute(new NextRequest(`${ORIGIN}/api/gallery?dir=${dir}&facets=1`, { headers }))],
    ['a picture', (dir, headers) => pictureRoute(new NextRequest(`${ORIGIN}/api/gallery/${dir}/pic.png`, { headers }), ctx({ dir, name: 'pic.png' }))],
    ['its thumbnail', (dir, headers) => pictureRoute(new NextRequest(`${ORIGIN}/api/gallery/${dir}/pic.png?thumb=1`, { headers }), ctx({ dir, name: 'pic.png' }))],
    ['its download', (dir, headers) => pictureRoute(new NextRequest(`${ORIGIN}/api/gallery/${dir}/pic.png?download=clean`, { headers }), ctx({ dir, name: 'pic.png' }))],
    ['its stars', (dir, headers) => ratingRoute(new Request(`${ORIGIN}/api/gallery/${dir}/pic.png/rating`, { ...json(headers, { stars: 3 }), method: 'PUT' }), ctx({ dir, name: 'pic.png' }))],
    ['its tags', (dir, headers) => tagsRoute(new Request(`${ORIGIN}/api/gallery/${dir}/pic.png/tags`, json(headers, { tags: ['x'] })), ctx({ dir, name: 'pic.png' }))],
    ['tagging the folder', (dir, headers) => autotagRoute(new Request(`${ORIGIN}/api/gallery/${dir}/autotag`, json(headers, { names: ['pic.png'] })), ctx({ dir }))],
    ['a ZIP of it', (dir, headers) => downloadRoute(new Request(`${ORIGIN}/api/gallery/download`, json(headers, { dir: Number(dir), names: ['pic.png'] })))],
  ]
  for (const [what, call] of routes) {
    const missing = await answer(await call('9', phone))
    eq(await answer(await call('0', phone)), missing, `${what}: a paired device gets for the save folder what it gets for one that does not exist`)
    eq(await answer(await call('1', phone)), missing, `${what}: and the same for a hidden read-only folder`)
  }
  eq((await pictureRoute(new NextRequest(`${ORIGIN}/api/gallery/2/pic.png`, { headers: phone }), ctx({ dir: '2', name: 'pic.png' }))).status, 200, 'a shared folder\'s picture is served to it')
  eq((await pictureRoute(new NextRequest(`${ORIGIN}/api/gallery/0/pic.png`, { headers: owner }), ctx({ dir: '0', name: 'pic.png' }))).status, 200, 'an owner device gets any folder\'s')
  eq((await pictureRoute(new NextRequest(`${ORIGIN}/api/gallery/1/pic.png`, { headers: local }), ctx({ dir: '1', name: 'pic.png' }))).status, 200, 'and so does this machine')

  // A grid sheet is built in the folder its cells were saved to: for a paired
  // device, its own, and only while it may see it.
  const sheet = (headers: Record<string, string>) => sheetRoute(new Request(`${ORIGIN}/api/gallery/sheet`, json(headers, { grid: GRID, rows: [['missing.png']] })))
  eq((await sheet(phone)).status, 400, 'a paired device builds a sheet from its shared save folder (here: no such cells)')
  const settingsFile = process.env.LATENTRY_SETTINGS_FILE!
  const stored = JSON.parse(readFileSync(settingsFile, 'utf8'))
  writeFileSync(settingsFile, JSON.stringify({ ...stored, gallery: { ...stored.gallery, shared: [folders.shown] } }))
  await new Promise((resolve) => setTimeout(resolve, 30))
  writeFileSync(settingsFile, JSON.stringify({ ...stored, gallery: { ...stored.gallery, shared: [folders.shown] } }))
  eq(await listed(phone), [2], 'with its save folder hidden again, a paired device does not see it')
  eq((await sheet(phone)).status, 409, 'nor builds a sheet from it, as when there is no save folder')

  // Every route under app/api/gallery goes through lib/gallery/access.ts (or, for the sheet, the viewer).
  const routeFiles: string[] = []
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(folder, entry.name))
      else if (entry.name === 'route.ts') routeFiles.push(path.join(folder, entry.name))
    }
  }
  walk(path.join(__dirname, '..', 'app', 'api', 'gallery'))
  for (const file of routeFiles) {
    const source = readFileSync(file, 'utf8')
    const name = path.relative(path.join(__dirname, '..'), file).replace(/\\/g, '/')
    check(/@\/lib\/gallery\/access|viewerOf\(/.test(source) && !/getGalleryDirs\(\)\[/.test(source), `${name} decides who may see the folder`)
  }

  // ── Runs ──
  const { GET: jobRoute } = await import('../app/api/gen/[backend]/job/route')
  const { GET: streamRoute } = await import('../app/api/gen/[backend]/job/stream/route')
  const { POST: cancelRoute } = await import('../app/api/gen/[backend]/cancel/route')
  const request = { prompt: 'p', negative_prompt: '', width: 8, height: 8, seed: 1, num_inference_steps: 1, guidance_scale: 1, image_count: 1, sampler: 'Euler' } as unknown as GenerateRequest
  const start = (startedBy: ReturnType<typeof viewer>) =>
    startJob({ backend: 'mock', total: 1, steps: 1, context: { request, profile: 'generic', kind: 'a1111', model: null, mode: 'txt2img', startedBy } })
  const current = async (headers: Record<string, string>) =>
    ((await (await jobRoute(new Request(`${ORIGIN}/api/gen/mock/job`, { headers }), ctx({ backend: 'mock' }))).json()) as { job: { id: string } | null }).job?.id ?? null
  const firstEvent = async (id: string, headers: Record<string, string>) => {
    const response = await streamRoute(new NextRequest(`${ORIGIN}/api/gen/mock/job/stream?id=${id}`, { headers }), ctx({ backend: 'mock' }))
    const reader = response.body!.getReader()
    const { value } = await reader.read()
    await reader.cancel()
    return new TextDecoder().decode(value).split('\n')[0]
  }

  const mine = start(viewer(local))
  eq([await current(local), await current(owner), await current(phone)], [mine.id, mine.id, null], "this machine's run is offered to it and to an owner device, not to a paired device")
  eq(await firstEvent(mine.id, phone), 'event: end', 'a paired device that names it anyway is told it is gone')
  eq(await firstEvent(mine.id, local), 'event: snapshot', 'while this machine watches it')
  const cancelled = await cancelRoute(new Request(`${ORIGIN}/api/gen/mock/cancel`, json(phone, { job: mine.id })), ctx({ backend: 'mock' }))
  eq(cancelled.status, 409, 'nor can a paired device stop it')

  const theirs = start(viewer(phone))
  eq([await current(phone), await current(other), await current(local)], [theirs.id, null, theirs.id], "a paired device's run is offered to it and this machine, not to another device")
  eq(await firstEvent(theirs.id, phone), 'event: snapshot', 'and it watches it')

  // ── Where runs are saved ──
  writeFileSync(settingsFile, JSON.stringify(stored))
  await new Promise((resolve) => setTimeout(resolve, 30))
  writeFileSync(settingsFile, JSON.stringify(stored))
  const image = { seed: 1, image_base64: png.toString('base64') } as Parameters<typeof saveToGallery>[1]
  const pictures = (folder: string) => readdirSync(folder).filter((name) => name.endsWith('.png')).sort()
  const savedMine = await saveToGallery(mine, image, 0)
  eq([savedMine !== null, pictures(folders.save).length, pictures(folders.phones).length], [true, 2, 1], "this machine's run is saved to the save folder")
  const savedTheirs = await saveToGallery(theirs, image, 0)
  eq([savedTheirs !== null, pictures(folders.save).length, pictures(folders.phones).length], [true, 2, 2], "a paired device's run to the paired devices' save folder")
}

main()
  .then(() => done('folder-access'))
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => rmSync(scratch, { recursive: true, force: true }))
