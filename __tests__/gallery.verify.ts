/**
 * PNG text chunks (lib/gallery/png-meta.ts), saving with settings
 * (lib/gallery/save.ts) and the gallery's view of a folder (lib/gallery/fs.ts),
 * including the ways a name must not get out of its folder.
 *
 * Run with: npm test -- gallery
 */
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { deflateSync } from 'node:zlib'
import sharp from 'sharp'
import { check, done, eq } from './assert'
import {
  formatA1111Parameters,
  LATENTRY_KEY,
  metaFromText,
  parseA1111Parameters,
  parseComfyPrompt,
  PARAMETERS_KEY,
  pngSize,
  readChunks,
  readPngText,
  TAGS_KEY,
  writePngText,
  type LatentryRecord,
} from '../lib/gallery/png-meta'
import { invalidateListing, isSafeName, listModels, listPage, openInDir, readPngInfo, resolveInDir } from '../lib/gallery/fs'
import { settleIndex } from '../lib/gallery/folder-index'
import type { GalleryDir } from '../lib/gallery/dirs'
import { dealColumns, heightPerWidth } from '../lib/gallery/columns'

const RECORD: LatentryRecord = {
  schema: 1,
  backend: 'anima',
  kind: 'diffusers',
  profile: 'anima',
  model: 'Anima-Base (v1.0)',
  mode: 'img2img',
  prompt: '@artist, 1girl, 桜, smile',
  negative_prompt: 'lowres, bad hands',
  seed: 1234,
  width: 832,
  height: 1216,
  sampler: 'Euler',
  scheduler: 'Karras',
  steps: 30,
  cfg: 4.5,
  strength: 0.6,
  created: '2026-10-03T00:00:00.000Z',
}

async function main() {
  const png = await sharp({ create: { width: 16, height: 24, channels: 3, background: '#123456' } }).png().toBuffer()

  // ── Writing and reading ──
  const written = writePngText(png, {
    [PARAMETERS_KEY]: formatA1111Parameters(RECORD),
    [LATENTRY_KEY]: JSON.stringify(RECORD),
  })
  const chunks = readChunks(written).map((chunk) => chunk.type)
  // Both carry "桜", which Latin-1 cannot: iTXt.
  eq(chunks.slice(0, 3), ['IHDR', 'iTXt', 'iTXt'], 'text goes right after IHDR; non-Latin-1 text as iTXt')
  eq(readChunks(writePngText(png, { [PARAMETERS_KEY]: 'a cat' }))[1].type, 'tEXt', 'Latin-1 text stays plain tEXt')
  eq(chunks[chunks.length - 1], 'IEND', 'IEND stays last')
  eq(pngSize(written), { width: 16, height: 24 }, 'the size is read from IHDR')
  const decoded = await sharp(written).raw().toBuffer({ resolveWithObject: true })
  eq([decoded.info.width, decoded.info.height], [16, 24], 'the result is still a valid PNG (CRCs right)')

  const text = readPngText(written)
  const meta = metaFromText(text)
  eq(
    [meta?.source, meta?.prompt, meta?.negativePrompt, meta?.seed, meta?.strength, meta?.backend, meta?.profile],
    ['latentry', RECORD.prompt, RECORD.negative_prompt, 1234, 0.6, 'anima', 'anima'],
    'our record round-trips, Unicode included'
  )

  const params = parseA1111Parameters(text[PARAMETERS_KEY])
  eq(
    [params.prompt, params.negativePrompt, params.steps, params.cfg, params.seed, params.width, params.height, params.sampler, params.scheduler, params.model],
    [RECORD.prompt, RECORD.negative_prompt, 30, 4.5, 1234, 832, 1216, 'Euler', 'Karras', 'Anima-Base (v1.0)'],
    'the A1111 infotext we write is what an A1111 reader sees'
  )

  // Replacing one keyword keeps the others, and a big record is compressed.
  const retagged = writePngText(written, { [TAGS_KEY]: JSON.stringify([{ name: '1girl', category: 0, score: 0.99 }]) })
  const again = metaFromText(readPngText(retagged))
  eq([again?.prompt, again?.tags?.[0].name], [RECORD.prompt, '1girl'], 'tags join the record without disturbing it')
  const retagged2 = writePngText(retagged, { [TAGS_KEY]: JSON.stringify([{ name: 'smile', category: 0, score: 0.5 }]) })
  eq(readChunks(retagged2).filter((chunk) => chunk.type !== 'IDAT').length, readChunks(retagged).filter((chunk) => chunk.type !== 'IDAT').length, 'rewriting tags replaces the chunk rather than adding one')
  const huge = writePngText(png, { [LATENTRY_KEY]: JSON.stringify({ ...RECORD, prompt: 'x, '.repeat(3000) }) })
  check(readChunks(huge)[1].data[readChunks(huge)[1].data.indexOf(0) + 1] === 1, 'a long record is written compressed')
  eq(metaFromText(readPngText(huge))?.prompt.length, 'x, '.repeat(3000).length, 'and reads back whole')

  // ── Other tools' metadata ──
  const a1111 = parseA1111Parameters(
    'masterpiece, 1girl,\nlong hair\nNegative prompt: worst quality\nSteps: 28, Sampler: DPM++ 2M, Schedule type: Karras, CFG scale: 6, Seed: 42, Size: 1024x1024, Model: "waiNSFW, v14", Denoising strength: 0.5, Lora hashes: "a: 1, b: 2"'
  )
  eq(
    [a1111.prompt, a1111.negativePrompt, a1111.steps, a1111.sampler, a1111.scheduler, a1111.cfg, a1111.seed, a1111.width, a1111.model, a1111.strength],
    ['masterpiece, 1girl,\nlong hair', 'worst quality', 28, 'DPM++ 2M', 'Karras', 6, 42, 1024, 'waiNSFW, v14', 0.5],
    'A1111 infotext: multi-line prompt, quoted values with commas'
  )
  eq(parseA1111Parameters('just a prompt').prompt, 'just a prompt', 'infotext without settings')

  const comfy = parseComfyPrompt(
    JSON.stringify({
      '3': { class_type: 'KSampler', inputs: { seed: 7, steps: 25, cfg: 5.5, sampler_name: 'euler', scheduler: 'normal', denoise: 1, positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0], model: ['4', 0] } },
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'noob.safetensors' } },
      '5': { class_type: 'EmptyLatentImage', inputs: { width: 832, height: 1216, batch_size: 1 } },
      '6': { class_type: 'CLIPTextEncode', inputs: { text: '1girl, smile', clip: ['4', 1] } },
      '7': { class_type: 'CLIPTextEncode', inputs: { text: 'lowres', clip: ['4', 1] } },
    })
  )
  eq(
    [comfy?.prompt, comfy?.negativePrompt, comfy?.seed, comfy?.steps, comfy?.model, comfy?.width, comfy?.height, comfy?.strength],
    ['1girl, smile', 'lowres', 7, 25, 'noob.safetensors', 832, 1216, undefined],
    'ComfyUI graph: the sampler leads to the right prompts'
  )
  eq(parseComfyPrompt('{nope'), null, 'broken JSON')

  // zTXt (deflated Latin-1) is read too.
  const ztxt = Buffer.concat([Buffer.from('parameters\0\0', 'latin1'), deflateSync(Buffer.from('a cat\nSteps: 5, Seed: 1', 'latin1'))])
  const withZtxt = writePngText(png, {})
  const zChunks = readChunks(withZtxt)
  const header = Buffer.alloc(8)
  header.writeUInt32BE(ztxt.length, 0)
  header.write('zTXt', 4, 'latin1')
  const { crc32 } = await import('node:zlib')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), ztxt])) >>> 0, 0)
  const idhr = withZtxt.subarray(0, 8 + 12 + zChunks[0].data.length)
  const zPng = Buffer.concat([idhr, header, ztxt, crc, withZtxt.subarray(idhr.length)])
  eq(metaFromText(readPngText(zPng))?.seed, 1, 'zTXt is inflated')

  // ── Names ──
  for (const bad of ['../x.png', '..\\x.png', 'a/b.png', 'a\\b.png', '.hidden.png', 'x.txt', 'C:x.png'.replace('C:', 'C:\\'), '', 'x\0.png']) {
    check(!isSafeName(bad), `refused name ${JSON.stringify(bad)}`)
  }
  check(isSafeName('20261003-120000_anima_1_0.png') && isSafeName('a b.JPG'), 'plain names pass')

  // ── A folder ──
  const root = await mkdtemp(path.join(tmpdir(), 'latentry-'))
  const folder = path.join(root, 'out')
  const outside = path.join(root, 'secret')
  await mkdir(folder)
  await mkdir(outside)
  try {
    const dir: GalleryDir = { index: 0, path: folder, label: 'out', writable: true }
    await writeFile(path.join(folder, 'old.png'), written)
    await writeFile(path.join(folder, 'new.png'), retagged)
    await writeFile(path.join(folder, 'notes.txt'), 'not an image')
    await writeFile(path.join(outside, 'private.png'), png)
    const now = Date.now() / 1000
    await utimes(path.join(folder, 'old.png'), now - 100, now - 100)
    await utimes(path.join(folder, 'new.png'), now, now)

    const info = await readPngInfo(path.join(folder, 'new.png'))
    eq([info?.width, info?.height, Object.keys(info?.text ?? {}).sort()], [16, 24, [LATENTRY_KEY, PARAMETERS_KEY, TAGS_KEY].sort()], 'chunk headers are enough to read size and text')

    const page = await listPage(dir, { limit: 1, filter: {} })
    eq([page.items.map((item) => item.name), page.nextCursor !== null], [['new.png'], true], 'newest first, one per page')
    const page2 = await listPage(dir, { limit: 10, cursor: page.nextCursor, filter: {} })
    eq([page2.items.map((item) => item.name), page2.nextCursor], [['old.png'], null], 'the cursor continues; text files are not listed')
    eq(page2.items[0].meta?.seed, 1234, 'items carry their settings')
    const found = await listPage(dir, { limit: 10, filter: { q: 'SMILE, 1girl', backend: 'anima' } })
    eq(found.items.map((item) => item.name).sort(), ['new.png', 'old.png'], 'search matches comma-separated terms in any case')
    eq((await listPage(dir, { limit: 10, filter: { q: '"1girl"' } })).items.length, 2, 'an exact tag from the prompt')
    eq((await listPage(dir, { limit: 10, filter: { q: '"smile 1girl"' } })).items, [], 'two tags in quotes are not one tag')
    eq((await listPage(dir, { limit: 10, filter: { backend: 'sdxl' } })).items, [], 'the backend filter')

    // ── Orders and filters, in a folder of their own ──
    const sorting = path.join(root, 'sorting')
    await mkdir(sorting)
    const sortDir: GalleryDir = { index: 1, path: sorting, label: 'sorting', writable: false }
    const wide = await sharp({ create: { width: 32, height: 16, channels: 3, background: '#654321' } }).webp().toBuffer()
    await writeFile(path.join(sorting, 'p10.png'), written) // portrait, no WD14 tags
    await writeFile(path.join(sorting, 'p2.png'), retagged) // portrait, tagged
    await writeFile(path.join(sorting, 'wide.webp'), wide) // landscape, no settings
    await utimes(path.join(sorting, 'p10.png'), now - 3 * 24 * 60 * 60, now - 3 * 24 * 60 * 60)
    await utimes(path.join(sorting, 'p2.png'), now - 200, now - 200)
    await utimes(path.join(sorting, 'wide.webp'), now - 100, now - 100)
    const names = async (filter: Parameters<typeof listPage>[1]['filter']) =>
      (await listPage(sortDir, { limit: 10, filter })).items.map((item) => item.name)

    eq(await names({}), ['wide.webp', 'p2.png', 'p10.png'], 'newest first by default')
    eq(await names({ sort: 'oldest' }), ['p10.png', 'p2.png', 'wide.webp'], 'oldest first')
    eq(await names({ sort: 'name-asc' }), ['p2.png', 'p10.png', 'wide.webp'], 'name A–Z, numbers as numbers')
    const bySize = [
      ['p10.png', written.length],
      ['p2.png', retagged.length],
      ['wide.webp', wide.length],
    ] as const
    eq(await names({ sort: 'size-desc' }), [...bySize].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name), 'largest file first')

    const paged: string[] = []
    let cursor: string | null = null
    do {
      const next: Awaited<ReturnType<typeof listPage>> = await listPage(sortDir, { limit: 1, cursor, filter: { sort: 'name-desc' } })
      paged.push(...next.items.map((item) => item.name))
      cursor = next.nextCursor
    } while (cursor && paged.length < 10)
    eq(paged, ['wide.webp', 'p10.png', 'p2.png'], 'paging in another order visits every picture once')

    eq(await names({ orientation: 'landscape' }), ['wide.webp'], 'the shape filter')
    eq(await names({ orientation: 'portrait', sort: 'name-asc' }), ['p2.png', 'p10.png'], 'shape and order together')
    eq(await names({ formats: ['webp'] }), ['wide.webp'], 'the file type filter')
    eq(await names({ untagged: true }), ['wide.webp', 'p10.png'], 'the untagged filter')
    eq(await names({ since: 'day' }), ['wide.webp', 'p2.png'], 'the age filter')
    eq(await names({ source: 'none' }), ['wide.webp'], 'pictures without settings')
    eq(await names({ model: RECORD.model!, untagged: true }), ['p10.png'], 'model and untagged together')

    // ── Orders that need the folder read first ──
    const first = await listPage(sortDir, { limit: 10, filter: { sort: 'pixels-desc' } })
    check(Boolean(first.indexing && 'done' in first.indexing && first.indexing.total === 3) && first.items.length === 0, 'a meta order first reports that the folder is being read')
    await settleIndex(sortDir)
    eq(await names({ sort: 'pixels-desc' }), ['wide.webp', 'p2.png', 'p10.png'], 'most pixels first, once read')
    eq(await names({ sort: 'pixels-asc' }), ['p2.png', 'p10.png', 'wide.webp'], 'fewest pixels first')
    const madeFirst = Date.now() > Date.parse(RECORD.created) ? ['p2.png', 'p10.png', 'wide.webp'] : ['wide.webp', 'p2.png', 'p10.png']
    eq(await names({ sort: 'created-asc' }), madeFirst, "made, oldest first: the settings' time, else the file's")
    eq(await names({ sort: 'pixels-desc', orientation: 'portrait' }), ['p2.png', 'p10.png'], 'a meta order and a filter together')
    const pagedMeta: string[] = []
    let metaCursor: string | null = null
    do {
      const next: Awaited<ReturnType<typeof listPage>> = await listPage(sortDir, { limit: 1, cursor: metaCursor, filter: { sort: 'pixels-asc' } })
      pagedMeta.push(...next.items.map((item) => item.name))
      metaCursor = next.nextCursor
    } while (metaCursor && pagedMeta.length < 10)
    eq(pagedMeta, ['p2.png', 'p10.png', 'wide.webp'], 'paging in a meta order visits every picture once')
    check(!('pixels' in (await listPage(sortDir, { limit: 1, filter: { sort: 'pixels-desc' } })).items[0]), "the index's values stay out of the reply")
    eq(await listModels(sortDir), { models: [RECORD.model!] }, 'every model in the folder')

    const big = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#000000' } }).png().toBuffer()
    await writeFile(path.join(sorting, 'big.png'), big)
    invalidateListing(sortDir)
    const again = await listPage(sortDir, { limit: 10, filter: { sort: 'pixels-desc' } })
    eq(again.indexing, { done: 3, total: 4 }, 'a new file is read on its own; the others are already known')
    await settleIndex(sortDir)
    eq((await names({ sort: 'pixels-desc' }))[0], 'big.png', 'and then takes its place')

    check((await resolveInDir(dir, 'new.png')) !== null, 'a file in the folder resolves')
    eq(await resolveInDir(dir, '../secret/private.png'), null, 'a path out of the folder does not')
    eq(await resolveInDir(dir, 'missing.png'), null, 'a missing file does not')

    // openInDir: the open file is the one checked, read through its handle.
    {
      const opened = await openInDir(dir, 'new.png')
      check(opened !== null, 'a file in the folder opens')
      if (opened) {
        const bytes = await opened.handle.readFile()
        eq(bytes.equals(await readFile(path.join(folder, 'new.png'))), true, 'and reads as the file')
        eq(Number(opened.info.size), bytes.length, 'with its own stats')
        await opened.handle.close()
      }
      eq(await openInDir(dir, '../secret/private.png'), null, 'a path out of the folder does not open')
      eq(await openInDir(dir, 'missing.png'), null, 'nor a missing file')
    }

    let linked = false
    try {
      await symlink(path.join(outside, 'private.png'), path.join(folder, 'link.png'))
      linked = true
    } catch {
      // Creating symlinks needs a privilege on Windows; the case is skipped there.
    }
    if (linked) {
      eq(await resolveInDir(dir, 'link.png'), null, 'a symlink leading out of the folder is refused')
      eq(await openInDir(dir, 'link.png'), null, 'and does not open')
    } else {
      console.log('  (symlink case skipped: no privilege to create one)')
    }

    // writeTags only for the save folder, and it really rewrites the file.
    const { writeTags } = await import('../lib/gallery/save')
    eq(await writeTags({ ...dir, writable: false }, 'old.png', []), false, 'a read-only folder is never written')
    eq(await writeTags(dir, '../secret/private.png', []), false, 'nor a file outside it')
    eq(await writeTags(dir, 'old.png', [{ name: 'cat_ears', category: 0, score: 0.7 }]), true, 'the save folder is')
    eq(metaFromText(readPngText(await readFile(path.join(folder, 'old.png'))))?.tags?.[0].name, 'cat_ears', 'and the tags are in the file')
  } finally {
    // libvips keeps files it read open in its cache; Windows will not delete them while it does.
    sharp.cache(false)
    await rm(root, { recursive: true, force: true })
  }

  // Masonry columns: each picture to the shortest column, in order.
  eq(heightPerWidth(832, 1216), 1216 / 832, 'height per width')
  eq(heightPerWidth(null, 500), 1, 'unknown sizes count as square')
  eq(dealColumns([1, 1, 1, 1, 1], 3), [[0, 3], [1, 4], [2]], 'equal heights go round left to right')
  eq(dealColumns([2, 1, 1, 1], 2), [[0, 3], [1, 2]], 'a tall picture takes two short ones to even out')
  eq(dealColumns([1, 1], 0), [[0, 1]], 'at least one column')
  {
    // Loading more must not move what is on screen: the first page's deal is
    // a prefix of the deal with the next page added.
    const heights = Array.from({ length: 60 }, (_, i) => [1.46, 0.69, 1, 1.78, 0.56][i % 5] + 0.3)
    const first = dealColumns(heights.slice(0, 24), 5)
    const both = dealColumns(heights, 5)
    check(first.every((column, i) => column.every((index, at) => both[i][at] === index)), 'a new page only adds to the bottoms')
  }

  done('gallery')
}

void main()
