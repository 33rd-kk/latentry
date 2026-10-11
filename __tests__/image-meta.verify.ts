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
  modelFileName,
  parseA1111Parameters,
  parseComfyPrompt,
  parseComfyWorkflow,
  parseLatentryRecord,
  readExifText,
  readImageInfo,
  readPngText,
  writePngText,
  PARAMETERS_KEY,
  type ImageMeta,
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

  await comfyGraphs()

  done('image-meta')
}

// ── ComfyUI's graphs: made up here, shaped like what ComfyUI writes ──
async function comfyGraphs(): Promise<void> {
  const settings = (meta: ImageMeta | null | undefined) =>
    meta && { prompt: meta.prompt, negativePrompt: meta.negativePrompt, seed: meta.seed, steps: meta.steps, cfg: meta.cfg, sampler: meta.sampler, scheduler: meta.scheduler, strength: meta.strength, model: meta.model, width: meta.width, height: meta.height }

  eq([modelFileName('sdxl\\anime\\base.safetensors'), modelFileName('flux/dev.gguf'), modelFileName(' plain.ckpt ')], ['base.safetensors', 'dev.gguf', 'plain.ckpt'], 'a model is shown by its file name, without folders')

  const txt2img = {
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sdxl\\anime\\base.safetensors' } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: 'a lighthouse at dusk', clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry', clip: ['4', 1] } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: 832, height: 1216, batch_size: 1 } },
    '10': { class_type: 'Seed (rgthree)', inputs: { seed: 42 } },
    '3': {
      class_type: 'KSampler',
      inputs: { seed: ['10', 0], steps: 30, cfg: 5.5, sampler_name: 'euler_ancestral', scheduler: 'karras', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] },
    },
  }
  const expected = { prompt: 'a lighthouse at dusk', negativePrompt: 'blurry', seed: 42, steps: 30, cfg: 5.5, sampler: 'euler_ancestral', scheduler: 'karras', strength: undefined, model: 'base.safetensors', width: 832, height: 1216 }
  eq(settings(parseComfyPrompt(JSON.stringify(txt2img))), expected, 'ComfyUI: prompts, settings, a seed from a seed node, size, and the model by file name')

  // A hires pass met first (keys like these iterate in numeric order): the
  // base is the sampler that starts from an empty latent.
  const hires = {
    ...txt2img,
    '2': { class_type: 'KSampler', inputs: { ...txt2img['3'].inputs, seed: 2, denoise: 0.5, latent_image: ['1', 0] } },
    '1': { class_type: 'LatentUpscale', inputs: { samples: ['3', 0], width: 1664, height: 2432 } },
  }
  eq(settings(parseComfyPrompt(JSON.stringify(hires))), expected, 'ComfyUI: with a second pass, the base pass is read')

  const custom = {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: 'flux/flux1-dev.safetensors', weight_dtype: 'default' } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: 'a red fox' } },
    '8': { class_type: 'CLIPTextEncode', inputs: { text: 'ugly' } },
    '3': { class_type: 'RandomNoise', inputs: { noise_seed: 99 } },
    '4': { class_type: 'CFGGuider', inputs: { cfg: 3.5, positive: ['2', 0], negative: ['8', 0], model: ['1', 0] } },
    '5': { class_type: 'KSamplerSelect', inputs: { sampler_name: 'dpmpp_2m' } },
    '6': { class_type: 'BasicScheduler', inputs: { scheduler: 'simple', steps: 20, denoise: 1, model: ['1', 0] } },
    '7': { class_type: 'EmptySD3LatentImage', inputs: { width: 1024, height: 768, batch_size: 1 } },
    '9': { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['3', 0], guider: ['4', 0], sampler: ['5', 0], sigmas: ['6', 0], latent_image: ['7', 0] } },
  }
  eq(
    settings(parseComfyPrompt(JSON.stringify(custom))),
    { prompt: 'a red fox', negativePrompt: 'ugly', seed: 99, steps: 20, cfg: 3.5, sampler: 'dpmpp_2m', scheduler: 'simple', strength: undefined, model: 'flux1-dev.safetensors', width: 1024, height: 768 },
    'ComfyUI: SamplerCustomAdvanced, from its noise, guider, sampler and sigmas nodes, with a UNET loader'
  )

  // The editor's graph, for a picture that carries only that.
  const workflow = {
    nodes: [
      { id: 4, type: 'CheckpointLoaderSimple', mode: 0, widgets_values: ['pony\\v6.safetensors'] },
      { id: 6, type: 'CLIPTextEncode', mode: 0, inputs: [{ name: 'clip', link: 3 }], widgets_values: ['a castle <lora:glow:0.5>'] },
      { id: 7, type: 'CLIPTextEncode', mode: 0, inputs: [{ name: 'clip', link: 5 }], widgets_values: ['lowres'] },
      { id: 5, type: 'EmptyLatentImage', mode: 0, widgets_values: [512, 768, 1] },
      { id: 8, type: 'LoraLoader', mode: 0, widgets_values: ['styles/ink.safetensors', 0.8, 0.8] },
      { id: 9, type: 'LoraLoader', mode: 4, widgets_values: ['bypassed.safetensors', 1, 1] },
      {
        id: 3,
        type: 'KSampler',
        mode: 0,
        inputs: [{ name: 'model', link: 1 }, { name: 'positive', link: 4 }, { name: 'negative', link: 6 }, { name: 'latent_image', link: 2 }],
        widgets_values: [7, 'randomize', 25, 6, 'euler', 'normal', 1],
      },
    ],
    links: [[1, 4, 0, 3, 0, 'MODEL'], [2, 5, 0, 3, 3, 'LATENT'], [3, 4, 1, 6, 0, 'CLIP'], [4, 6, 0, 3, 1, 'CONDITIONING'], [5, 4, 1, 7, 0, 'CLIP'], [6, 7, 0, 3, 2, 'CONDITIONING']],
  }
  const fromWorkflow = { prompt: 'a castle <lora:glow:0.5>', negativePrompt: 'lowres', seed: 7, steps: 25, cfg: 6, sampler: 'euler', scheduler: 'normal', strength: undefined, model: 'v6.safetensors', width: 512, height: 768 }
  const read = parseComfyWorkflow(JSON.stringify(workflow))
  eq(settings(read), fromWorkflow, "ComfyUI's editor graph: the sampler's widgets, its prompts through the links, size and model")
  eq([read?.source, read?.loras], ['comfyui', ['glow', 'ink']], 'with the LoRAs of loaders that ran and of the prompt')
  const older = { ...workflow, nodes: workflow.nodes.map((node) => (node.type === 'KSampler' ? { ...node, widgets_values: [7, 25, 6, 'euler', 'normal', 1] } : node)) }
  eq(settings(parseComfyWorkflow(JSON.stringify(older))), fromWorkflow, 'also without the seed control widget')
  eq(settings(metaFromText({ workflow: JSON.stringify(workflow) })), fromWorkflow, 'a picture with only a workflow chunk has settings')
  eq(metaFromText({ prompt: 'not a graph', workflow: JSON.stringify(workflow) })?.prompt, fromWorkflow.prompt, 'and so does one whose prompt chunk cannot be read')
  eq(parseComfyWorkflow('{"nodes": "x"}'), null, 'a workflow without nodes is nothing')

  // Through a real PNG: ComfyUI writes its graph as a tEXt chunk named "prompt".
  const png = writePngText(await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } }).png().toBuffer(), { prompt: JSON.stringify(txt2img) })
  eq(settings(metaFromText(readPngText(png))), expected, 'a PNG with a ComfyUI prompt chunk reads back the same')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
