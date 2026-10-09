/**
 * lib/image-meta: sizes and settings from PNG, JPEG and WebP headers, the
 * EXIF fields that carry settings, and LoRA names from each tool's format.
 *
 * Run with: npm test -- image-meta
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { check, done, eq } from './assert'
import {
  decodeUserComment,
  loraCallsInPrompt,
  loraName,
  lorasInPrompt,
  formatA1111Parameters,
  metaFromText,
  parseA1111Parameters,
  parseComfyPrompt,
  parseLatentryRecord,
  readExifText,
  readImageInfo,
  writePngText,
  PARAMETERS_KEY,
} from '../lib/image-meta'

const INFOTEXT =
  'masterpiece, 1girl, <lora:detail_tweaker:0.6>, smile\nNegative prompt: lowres\nSteps: 28, Sampler: Euler a, CFG scale: 5, Seed: 77, Size: 64x96, Model: noobai, Lora hashes: "detail_tweaker: 1a2b, sub/style.safetensors: 3c4d"'

// ── A minimal TIFF/EXIF block, built by hand so every encoding can be tried ──
type Entry = { tag: number; type: number; data: Buffer }

function tiff(little: boolean, ifd0: Entry[], exif: Entry[]): Buffer {
  const u16 = (v: number) => {
    const b = Buffer.alloc(2)
    if (little) b.writeUInt16LE(v)
    else b.writeUInt16BE(v)
    return b
  }
  const u32 = (v: number) => {
    const b = Buffer.alloc(4)
    if (little) b.writeUInt32LE(v)
    else b.writeUInt32BE(v)
    return b
  }
  const ifdSize = (n: number) => 2 + n * 12 + 4
  const withPointer = [...ifd0, { tag: 0x8769, type: 4, data: Buffer.alloc(4) }]
  const ifd0At = 8
  const exifAt = ifd0At + ifdSize(withPointer.length)
  let dataAt = exifAt + ifdSize(exif.length)
  const blobs: Buffer[] = []
  const ifd = (entries: Entry[]) => {
    const parts: Buffer[] = [u16(entries.length)]
    for (const entry of entries) {
      const data = entry.tag === 0x8769 ? u32(exifAt) : entry.data
      const count = entry.type === 3 ? data.length / 2 : entry.type === 4 ? data.length / 4 : data.length
      let value: Buffer
      if (data.length <= 4) value = Buffer.concat([data, Buffer.alloc(4 - data.length)])
      else {
        value = u32(dataAt)
        blobs.push(data)
        dataAt += data.length
      }
      parts.push(u16(entry.tag), u16(entry.type), u32(count), value)
    }
    parts.push(u32(0))
    return Buffer.concat(parts)
  }
  const head = Buffer.concat([Buffer.from(little ? 'II' : 'MM', 'latin1'), u16(42), u32(ifd0At)])
  const first = ifd(withPointer)
  const second = ifd(exif)
  return Buffer.concat([head, first, second, ...blobs])
}

const ascii = (text: string) => Buffer.from(text + '\0', 'utf8')
const comment = (code: string, body: Buffer) => Buffer.concat([Buffer.from(code.padEnd(8, '\0'), 'latin1'), body])
const utf16be = (text: string) => Buffer.from(text, 'utf16le').swap16()

async function main() {
  // ── UserComment encodings ──
  eq(decodeUserComment(comment('UNICODE', utf16be('a cat, 猫'))), 'a cat, 猫', 'UNICODE, big-endian (piexif)')
  eq(decodeUserComment(comment('UNICODE', Buffer.from('a cat, 猫', 'utf16le'))), 'a cat, 猫', 'UNICODE, little-endian')
  eq(decodeUserComment(comment('ASCII', Buffer.from('a cat'))), 'a cat', 'ASCII')
  eq(decodeUserComment(comment('', Buffer.from('a cat'))), 'a cat', 'undefined code: read as UTF-8')
  eq(decodeUserComment(Buffer.from('short')), undefined, 'shorter than its code')
  eq(decodeUserComment(comment('ASCII', Buffer.from('\0\0'))), undefined, 'empty')

  // ── EXIF blocks in both byte orders ──
  for (const little of [true, false]) {
    const block = tiff(
      little,
      [
        { tag: 0x010e, type: 2, data: ascii('a description') },
        { tag: 0x010f, type: 2, data: ascii('Prompt: {"1":{}}') },
      ],
      [{ tag: 0x9286, type: 7, data: comment('UNICODE', utf16be(INFOTEXT)) }]
    )
    const read = readExifText(Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), block]))
    eq([read?.userComment, read?.imageDescription, read?.make], [INFOTEXT, 'a description', 'Prompt: {"1":{}}'], `EXIF fields (${little ? 'II' : 'MM'})`)
  }
  eq(readExifText(Buffer.from('not exif at all')), null, 'not TIFF')
  eq(readExifText(Buffer.from('II*\0\xff\xff\xff\x7f', 'latin1')), { userComment: undefined, imageDescription: undefined, make: undefined, model: undefined }, 'an IFD offset past the end is ignored')

  const root = await mkdtemp(path.join(tmpdir(), 'image-meta-'))
  try {
    const at = (name: string) => path.join(root, name)
    const base = sharp({ create: { width: 64, height: 96, channels: 3, background: '#336699' } })
    const exifBlock = tiff(true, [], [{ tag: 0x9286, type: 7, data: comment('UNICODE', utf16be(INFOTEXT)) }])

    // ── PNG ──
    await writeFile(at('a.png'), writePngText(await base.clone().png().toBuffer(), { [PARAMETERS_KEY]: INFOTEXT }))
    const png = await readImageInfo(at('a.png'))
    eq([png?.format, png?.width, png?.height, png?.text.parameters], ['png', 64, 96, INFOTEXT], 'PNG: size and text')

    // ── JPEG: APP1 put in by hand after SOI ──
    const jpeg = await base.clone().jpeg().toBuffer()
    const app1Body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), exifBlock])
    const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.from([(app1Body.length + 2) >> 8, (app1Body.length + 2) & 0xff]), app1Body])
    await writeFile(at('a.jpg'), Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]))
    const jpg = await readImageInfo(at('a.jpg'))
    eq([jpg?.format, jpg?.width, jpg?.height], ['jpeg', 64, 96], 'JPEG: size from SOF')
    eq(metaFromText(jpg?.text ?? {})?.seed, 77, "JPEG: A1111's infotext from UserComment")

    // ── WebP: lossy, lossless, and extended with an EXIF chunk ──
    await writeFile(at('lossy.webp'), await base.clone().webp().toBuffer())
    await writeFile(at('lossless.webp'), await base.clone().webp({ lossless: true }).toBuffer())
    eq([(await readImageInfo(at('lossy.webp')))?.width, (await readImageInfo(at('lossy.webp')))?.height], [64, 96], 'WebP VP8: size')
    eq([(await readImageInfo(at('lossless.webp')))?.width, (await readImageInfo(at('lossless.webp')))?.height], [64, 96], 'WebP VP8L: size')

    const simple = await base.clone().webp().toBuffer()
    const vp8 = simple.subarray(12)
    const vp8x = Buffer.alloc(18)
    vp8x.write('VP8X', 0, 'latin1')
    vp8x.writeUInt32LE(10, 4)
    vp8x[8] = 0x08 // EXIF present
    vp8x.writeUIntLE(64 - 1, 12, 3)
    vp8x.writeUIntLE(96 - 1, 15, 3)
    const exifChunkHead = Buffer.alloc(8)
    exifChunkHead.write('EXIF', 0, 'latin1')
    exifChunkHead.writeUInt32LE(exifBlock.length, 4)
    const exifChunk = Buffer.concat([exifChunkHead, exifBlock, exifBlock.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)])
    const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), vp8x, vp8, exifChunk])
    const riff = Buffer.alloc(8)
    riff.write('RIFF', 0, 'latin1')
    riff.writeUInt32LE(body.length, 4)
    await writeFile(at('extended.webp'), Buffer.concat([riff, body]))
    const webp = await readImageInfo(at('extended.webp'))
    eq([webp?.format, webp?.width, webp?.height], ['webp', 64, 96], 'WebP VP8X: size')
    eq(metaFromText(webp?.text ?? {})?.loras, ['detail_tweaker', 'style'], "WebP: A1111's infotext from EXIF, LoRAs included")

    // A WebP as sharp writes it with EXIF, for a real container.
    await writeFile(at('sharp.webp'), await base.clone().withExif({ IFD0: { Make: 'Prompt: {"3":{"class_type":"KSampler","inputs":{"seed":5}}}' } }).webp().toBuffer())
    const comfy = await readImageInfo(at('sharp.webp'))
    eq(metaFromText(comfy?.text ?? {})?.seed, 5, "WebP: ComfyUI's graph from EXIF Make")

    // ── Not pictures, and broken ones ──
    await writeFile(at('text.png'), 'just text')
    eq(await readImageInfo(at('text.png')), null, 'a file that is no picture')
    await writeFile(at('cut.jpg'), jpeg.subarray(0, 40))
    check((await readImageInfo(at('cut.jpg')))?.format === 'jpeg', 'a cut-off JPEG still answers, without throwing')
    await writeFile(at('cut.webp'), Buffer.concat([riff, body]).subarray(0, 30))
    check((await readImageInfo(at('cut.webp')))?.format === 'webp', 'a cut-off WebP still answers, without throwing')
  } finally {
    await rm(root, { recursive: true, force: true })
  }

  // ── LoRA names ──
  eq([loraName('sub\\dir/style.safetensors'), loraName(' detail '), loraName('x.ckpt')], ['style', 'detail', 'x'], 'no folder, no extension')
  eq(lorasInPrompt('a <lora:one:0.5>, <LyCo:two>, <lora:sub/three.safetensors:1>'), ['one', 'two', 'three'], 'lora and lyco calls in a prompt')
  eq(parseA1111Parameters(INFOTEXT).loras, ['detail_tweaker', 'style'], 'A1111: prompt and Lora hashes, each once')
  eq(parseA1111Parameters('just a prompt').loras, undefined, 'none when there are none')
  const graph = {
    '1': { class_type: 'LoraLoader', inputs: { lora_name: 'chars/hero.safetensors' } },
    '2': { class_type: 'Power Lora Loader (rgthree)', inputs: { lora_1: { on: true, lora: 'light.safetensors' }, lora_2: { on: false, lora: 'off.safetensors' } } },
    '3': { class_type: 'KSampler', inputs: { positive: ['4', 0], seed: 1 } },
    '4': { class_type: 'CLIPTextEncode', inputs: { text: 'a hero <lora:prompted:1>' } },
  }
  eq(parseComfyPrompt(JSON.stringify(graph))?.loras, ['prompted', 'hero', 'light'], 'ComfyUI: loader nodes and prompt calls; a slot switched off is not')
  eq(
    loraCallsInPrompt('<lora:one:0.5>, <lyco:two>, <lora:three:x>, <lora:four:0.8:0.2>, <lora: :1>'),
    [{ name: 'one', weight: 0.5 }, { name: 'two', weight: 1 }, { name: 'three', weight: 1 }, { name: 'four', weight: 0.8 }],
    'calls with weights: the first number, else 1'
  )
  const base = { schema: 1, backend: 'engine', kind: 'diffusers', profile: 'sdxl', model: null, mode: 'txt2img', prompt: 'x, <lora:style:0.6>', negative_prompt: '', seed: 1, width: 8, height: 8, sampler: 'Euler', scheduler: 'Default', steps: 1, cfg: 5, created: '' } as const
  check(!formatA1111Parameters(base).includes('Lora hashes'), 'no Lora hashes unless given')
  check(!formatA1111Parameters(base, [{ name: 'style', weight: 0.6 }]).includes('Lora hashes'), 'nor for LoRAs without a hash')
  const hashed = formatA1111Parameters(base, [{ name: 'style', weight: 0.6, hash: 'abcdef012345' }, { name: 'b', weight: 1, hash: '0123456789ab' }])
  check(hashed.includes('Lora hashes: "style: abcdef012345, b: 0123456789ab"'), 'Lora hashes as A1111 writes them')
  eq(parseA1111Parameters(hashed).loras, ['style', 'b'], 'and read back as A1111 infotext')
  const record = (fields: object) => parseLatentryRecord(JSON.stringify({ schema: 1, prompt: 'x, <lora:mine:0.7>', ...fields }))?.loras
  eq(record({ kind: 'diffusers', loras: [{ name: 'applied', weight: 1 }] }), ['applied'], "Latentry's record: the LoRAs the backend applied, not the prompt's")
  eq(record({ kind: 'diffusers', loras: [] }), undefined, "Latentry's record: an empty list is none")
  eq(record({ kind: 'diffusers' }), undefined, "Latentry's record, older: a prompt call alone is not a LoRA used")
  eq(record({ kind: 'a1111' }), ['mine'], "Latentry's record, older, from A1111: it applied the prompt's calls")

  done('image-meta')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
