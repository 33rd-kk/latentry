/**
 * Saving pictures without their settings (lib/image-meta/strip.ts), the ZIP
 * of several (lib/gallery/zip.ts), and the routes that send them.
 *
 * Run with: npm test -- strip
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { crc32 } from 'node:zlib'
import sharp from 'sharp'
import { check, done, eq } from './assert'
import { GET as pictureRoute } from '../app/api/gallery/[dir]/[name]/route'
import { POST as downloadRoute } from '../app/api/gallery/download/route'
import { attachment, zipStore } from '../lib/gallery/zip'
import {
  encodeChunk,
  exifOrientation,
  readChunks,
  readImageInfo,
  stripJpeg,
  stripMetadata,
  stripPng,
  stripPngBytes,
  stripWebp,
  writePngText,
} from '../lib/image-meta'

const SECRET = 'masterpiece, a secret prompt'

async function pixels(bytes: Buffer): Promise<Buffer> {
  return sharp(bytes).raw().toBuffer()
}

/** What every reader of settings finds in a file: none of it should be left. */
async function textIn(bytes: Buffer, extension: string, scratch: string): Promise<Record<string, string>> {
  const file = path.join(scratch, `probe${extension}`)
  writeFileSync(file, bytes)
  return (await readImageInfo(file))?.text ?? {}
}

/** Entries of a stored ZIP, read back by its central directory, each checked against its CRC. */
function unzip(zip: Buffer): { name: string; data: Buffer; date: number }[] {
  const end = zip.length - 22
  check(zip.readUInt32LE(end) === 0x06054b50, 'the archive ends with its directory record')
  const count = zip.readUInt16LE(end + 10)
  let at = zip.readUInt32LE(end + 16)
  const out = []
  for (let i = 0; i < count; i += 1) {
    const nameLength = zip.readUInt16LE(at + 28)
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength)
    const size = zip.readUInt32LE(at + 24)
    const crc = zip.readUInt32LE(at + 16)
    const date = zip.readUInt16LE(at + 14)
    const local = zip.readUInt32LE(at + 42)
    const dataAt = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    const data = zip.subarray(dataAt, dataAt + size)
    check((crc32(data) >>> 0) === crc, `${name}: its CRC matches`)
    out.push({ name, data, date })
    at += 46 + nameLength
  }
  return out
}

async function main() {
  const scratch = mkdtempSync(path.join(tmpdir(), 'latentry-strip-'))
  try {
    const image = sharp({ create: { width: 8, height: 6, channels: 3, background: { r: 200, g: 40, b: 90 } } })

    // ── PNG ──
    const plain = await image.clone().withIccProfile('srgb').png().toBuffer()
    const withText = writePngText(plain, { parameters: `${SECRET}\nSteps: 20, Seed: 1`, latentry: JSON.stringify({ schema: 1, prompt: SECRET }), prompt: '{"3":{}}', workflow: '{}' })
    const chunks = readChunks(withText)
    const iend = chunks.length - 1
    const png = Buffer.concat([
      withText.subarray(0, 8),
      ...chunks.slice(0, iend).map((chunk) => encodeChunk(chunk.type, chunk.data)),
      encodeChunk('eXIf', Buffer.from('MM\0*\0\0\0\x08\0\0', 'latin1')),
      encodeChunk('tIME', Buffer.from([7, 234, 11, 3, 12, 0, 0])),
      encodeChunk('IEND', Buffer.alloc(0)),
    ])
    check(Object.keys(await textIn(png, '.png', scratch)).length >= 3, 'the PNG starts with its settings')
    const cleanPng = stripPng(png)!
    eq(await textIn(cleanPng, '.png', scratch), {}, 'PNG: no settings are left for any reader')
    const types = readChunks(cleanPng).map((chunk) => chunk.type)
    check(!types.some((type) => ['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME'].includes(type)), 'no text, EXIF or time chunk')
    check(types.includes('iCCP'), 'the colour profile stays')
    check(!cleanPng.includes(Buffer.from('secret prompt')), 'and the prompt is nowhere in the bytes')
    check((await pixels(cleanPng)).equals(await pixels(png)), 'the pixels are exactly as they were')
    check(stripPng(png.subarray(0, png.length - 20)) === null, 'a cut-off PNG is refused')
    // The browser's copy (Generate's Save without settings) is the same function on plain bytes.
    const fromBytes = stripPngBytes(new Uint8Array(png))
    check(!!fromBytes && Buffer.from(fromBytes).equals(cleanPng), 'on plain bytes: the same file as the server makes')
    const kept = readChunks(png).filter((chunk) => !['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME'].includes(chunk.type))
    check(Buffer.concat([png.subarray(0, 8), ...kept.map((chunk) => encodeChunk(chunk.type, chunk.data))]).equals(cleanPng), 'every chunk that stays is as it was, CRC included')
    check(stripPngBytes(new Uint8Array(png.subarray(0, png.length - 20))) === null, 'on plain bytes, a cut-off PNG is refused too')
    check(stripPngBytes(new Uint8Array(png.subarray(8))) === null && stripPngBytes(new Uint8Array(0)) === null, 'and so is one without its signature')
    const offset = new Uint8Array(png.length + 3)
    offset.set(png, 3)
    check(!!stripPngBytes(offset.subarray(3))?.every((byte, i) => byte === cleanPng[i]), 'a view into a larger buffer reads from its own start')

    // ── JPEG ──
    const jpeg = await image
      .clone()
      .withIccProfile('srgb')
      .withMetadata({ orientation: 6 })
      .withExif({ IFD0: { ImageDescription: SECRET, Software: 'tool', Make: 'Prompt: {"3":{}}' } })
      .jpeg()
      .toBuffer()
    const withComment = Buffer.concat([jpeg.subarray(0, 2), Buffer.from([0xff, 0xfe, 0, 2 + 6]), Buffer.from('notes!'), jpeg.subarray(2)])
    check(Object.keys(await textIn(withComment, '.jpg', scratch)).length > 0, 'the JPEG starts with a description')
    const cleanJpeg = stripJpeg(withComment)!
    eq(await textIn(cleanJpeg, '.jpg', scratch), {}, 'JPEG: no settings are left for any reader')
    check(!cleanJpeg.includes(Buffer.from('secret prompt')) && !cleanJpeg.includes(Buffer.from('notes!')), 'the description and the comment are gone')
    check(cleanJpeg.includes(Buffer.from('ICC_PROFILE')), 'the colour profile stays')
    const app1 = cleanJpeg.indexOf(Buffer.from('Exif\0\0', 'latin1'))
    check(app1 > 0 && exifOrientation(cleanJpeg.subarray(app1, app1 + 40)) === 6, 'the rotation stays, alone')
    eq((await sharp(cleanJpeg).metadata()).orientation, 6, 'and a reader still turns the picture')
    check((await pixels(cleanJpeg)).equals(await pixels(withComment)), 'the pixels are exactly as they were')
    const unrotated = await image.clone().withExif({ IFD0: { ImageDescription: SECRET } }).jpeg().toBuffer()
    check(!stripJpeg(unrotated)!.includes(Buffer.from('Exif\0\0', 'latin1')), 'without a rotation no EXIF is left at all')
    check(stripJpeg(jpeg.subarray(0, 40)) === null, 'a JPEG cut before its scan is refused')

    // ── WebP ──
    const webp = await image.clone().withExif({ IFD0: { ImageDescription: SECRET, Make: 'Prompt: {"3":{}}' } }).webp({ lossless: true }).toBuffer()
    check(Object.keys(await textIn(webp, '.webp', scratch)).length > 0, 'the WebP starts with its settings')
    const cleanWebp = stripWebp(webp)!
    eq(await textIn(cleanWebp, '.webp', scratch), {}, 'WebP: no settings are left for any reader')
    check(!cleanWebp.includes(Buffer.from('EXIF')) && !cleanWebp.includes(Buffer.from('secret prompt')), 'the EXIF chunk is gone')
    const vp8x = cleanWebp.indexOf(Buffer.from('VP8X'))
    check(vp8x === -1 || (cleanWebp[vp8x + 8] & 0x0c) === 0, 'and VP8X no longer says there is EXIF or XMP')
    eq(cleanWebp.readUInt32LE(4), cleanWebp.length - 8, 'the RIFF size is the new one')
    check((await pixels(cleanWebp)).equals(await pixels(webp)), 'the pixels are exactly as they were')
    check(stripWebp(webp.subarray(0, 30)) === null, 'a cut-off WebP is refused')

    // ── By format ──
    check(!!stripMetadata(png)?.equals(cleanPng) && !!stripMetadata(withComment)?.equals(cleanJpeg) && !!stripMetadata(webp)?.equals(cleanWebp), 'each format by its first bytes')
    check(stripMetadata(Buffer.from('GIF89a......')) === null && stripMetadata(Buffer.alloc(0)) === null, 'anything else is refused')

    // ── ZIP ──
    const zip = zipStore([
      { name: 'a.png', data: cleanPng },
      { name: '日本語.webp', data: cleanWebp },
    ])
    const entries = unzip(zip)
    eq(entries.map((entry) => entry.name), ['a.png', '日本語.webp'], 'entries by name, UTF-8 included')
    check(entries[0].data.equals(cleanPng) && entries[1].data.equals(cleanWebp), 'stored as they are')
    check(entries.every((entry) => entry.date === 0x21), 'every entry dated 1980-01-01: the archive says nothing about when')
    eq(attachment('a "b".png'), `attachment; filename="a _b_.png"; filename*=UTF-8''a%20%22b%22.png`, 'a file name for the header')
    eq(attachment('絵.png'), `attachment; filename="_.png"; filename*=UTF-8''%E7%B5%B5.png`, 'with a plain fallback')

    // ── The routes ──
    const folder = path.join(scratch, 'out')
    mkdirSync(folder)
    writeFileSync(path.join(folder, 'a.png'), png)
    writeFileSync(path.join(folder, 'b.jpg'), withComment)
    writeFileSync(path.join(folder, 'broken.png'), png.subarray(0, 100))
    const saved = { settings: process.env.LATENTRY_SETTINGS_FILE, save: process.env.GALLERY_SAVE_DIR, dirs: process.env.GALLERY_DIRS }
    process.env.LATENTRY_SETTINGS_FILE = path.join(scratch, 'latentry.settings.json')
    process.env.GALLERY_SAVE_DIR = folder
    delete process.env.GALLERY_DIRS
    try {
      const ORIGIN = 'http://localhost:3000'
      const { NextRequest } = await import('next/server')
      const get = (name: string, query: string) =>
        pictureRoute(new NextRequest(`${ORIGIN}/api/gallery/0/${encodeURIComponent(name)}${query}`, { headers: { host: 'localhost:3000' } }), { params: Promise.resolve({ dir: '0', name }) } as never)
      const clean = await get('a.png', '?download=clean')
      eq(clean.status, 200, 'one picture without its settings')
      check(Buffer.from(await clean.arrayBuffer()).equals(cleanPng), 'cleaned')
      eq(clean.headers.get('content-disposition'), attachment('a.png'), 'as a download under its own name')
      const original = await get('a.png', '?download=original')
      check(Buffer.from(await original.arrayBuffer()).equals(png) && original.headers.get('content-disposition') === attachment('a.png'), 'or as it is, when asked')
      eq((await get('a.png', '')).headers.get('content-disposition'), null, 'showing a picture is not a download')
      eq((await get('broken.png', '?download=clean')).status, 422, 'a picture that cannot be cleaned is refused, not sent with its settings')

      const post = (body: unknown) =>
        downloadRoute(new Request(`${ORIGIN}/api/gallery/download`, { method: 'POST', headers: { host: 'localhost:3000', 'content-type': 'application/json' }, body: JSON.stringify(body) }))
      const many = await post({ dir: 0, names: ['a.png', 'b.jpg', 'broken.png', 'gone.png'] })
      eq(many.status, 200, 'several pictures at once')
      eq([many.headers.get('content-type'), many.headers.get('x-latentry-left-out')], ['application/zip', '2'], 'a ZIP, saying how many were left out')
      const got = unzip(Buffer.from(await many.arrayBuffer()))
      eq(got.map((entry) => entry.name), ['a.png', 'b.jpg'], 'by file name only, no folder')
      check(got[0].data.equals(cleanPng) && got[1].data.equals(cleanJpeg), 'each without its settings')
      const full = unzip(Buffer.from(await (await post({ dir: 0, names: ['a.png'], clean: false })).arrayBuffer()))
      check(full[0].data.equals(png), 'or as they are, when asked')
      eq(
        await Promise.all([{ dir: 0, names: [] }, { dir: 0, names: Array(201).fill('a.png') }, { dir: 0, names: [1] }].map(async (body) => (await post(body)).status)),
        [400, 400, 400],
        'between 1 and 200 names'
      )
      eq((await post({ dir: 5, names: ['a.png'] })).status, 404, 'in a folder that is there')
      eq((await post({ dir: 0, names: ['broken.png'] })).status, 422, 'and at least one picture that can be saved')
    } finally {
      for (const [name, value] of [
        ['LATENTRY_SETTINGS_FILE', saved.settings],
        ['GALLERY_SAVE_DIR', saved.save],
        ['GALLERY_DIRS', saved.dirs],
      ] as const) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

main()
  .then(() => done('strip'))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
