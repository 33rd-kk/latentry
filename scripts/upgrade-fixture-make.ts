// Run by scripts/upgrade-fixture.mjs, with an earlier release's lib/ as `@/`:
// writes that release's settings file and picture into the fixture folder,
// each made by the release's own code.
//
//   settings.json  what its validateSettings stores for a full edit
//   picture.png    an 8x8 PNG with the parameters, latentry and tags chunks it wrote
//
// Every value is made up: no real paths, pictures or tokens.

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { crc32, deflateSync } from 'node:zlib'

const [release, lib, out, fieldList] = process.argv.slice(2)
/* eslint-disable @typescript-eslint/no-require-imports */
const schema = require(path.join(lib, 'settings', 'schema.ts'))
const meta = require(path.join(lib, 'image-meta', 'index.ts'))
const kinds: string[] = require(path.join(lib, 'backends', 'types.ts')).BACKEND_KINDS
/* eslint-enable @typescript-eslint/no-require-imports */

// A full edit. A release ignores the parts it does not know.
const settingsInput = {
  backends: [
    { id: 'anima', kind: 'diffusers', url: 'http://127.0.0.1:7865', profile: 'anima', token: 'fixture-token' },
    // ComfyUI came in 0.7; before it, the second backend is an A1111.
    kinds.includes('comfyui')
      ? {
          id: 'comfy',
          kind: 'comfyui',
          url: 'http://127.0.0.1:8188',
          profile: 'illustrious',
          model: 'base.safetensors',
          controlnet: 'pose.safetensors',
          workflowsDir: '/fixture/workflows',
          shareWorkflows: true,
        }
      : { id: 'forge', kind: 'a1111', url: 'http://127.0.0.1:7860', profile: 'illustrious' },
  ],
  tagger: 'builtin',
  wd14: { modelDir: '/fixture/wd14', general: 0.4, character: 0.9 },
  gallery: { saveDir: '/fixture/out', dirs: ['/fixture/old'], autoTag: true, loraHashes: true, labels: { '/fixture/old': 'Old' } },
  profiles: { sdxl: { width: 1152, height: 896, steps: 28, cfg: 6, negativePrompt: 'lowres', qualityTags: 'best', tagStyle: 'space', keepTags: '' } },
  engine: { autoStart: false, modelsDir: '/fixture/models', basePort: 7900, gpus: [0], model: 'mine.safetensors', shareLoras: true },
  wildcards: { dir: '/fixture/wildcards', share: true },
}
const checked = schema.validateSettings(settingsInput, schema.EMPTY_SETTINGS, {})
if (!checked.ok) throw new Error(`${release}: settings refused: ${JSON.stringify(checked.errors)}`)

// The record, with only the fields the release wrote.
const fields = new Set(fieldList.split(','))
const full: Record<string, unknown> = {
  schema: 1,
  backend: 'anima',
  kind: 'diffusers',
  profile: 'anima',
  model: 'fixture.safetensors',
  mode: 'txt2img',
  prompt: '1girl, solo, smile',
  prompt_template: '1girl, solo, __mood__',
  negative_prompt: 'lowres',
  seed: 1234,
  width: 832,
  height: 1216,
  sampler: 'Euler',
  scheduler: 'Karras',
  steps: 30,
  cfg: 5,
  hires: { scale: 1.5, steps: 0, denoise: 0.35, upscaler: 'Lanczos' },
  loras: [{ name: 'style', weight: 0.6 }],
  workflow: 'portrait.json',
  grid: { id: 'g1', x: { axis: 'cfg', value: '5' } },
  created: '2026-10-08T07:48:36.401Z',
}
const record = Object.fromEntries(Object.entries(full).filter(([key]) => fields.has(key)))

// An 8x8 grey PNG, then the chunks as the release's gallery wrote them.
const chunk = (type: string, data: Buffer) => {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0)
  return Buffer.concat([head, data, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(8, 0)
ihdr.writeUInt32BE(8, 4)
ihdr[8] = 8
const rows = Buffer.concat(Array.from({ length: 8 }, () => Buffer.from([0, ...Array(8).fill(128)])))
let png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(rows)),
  chunk('IEND', Buffer.alloc(0)),
])
png = meta.writePngText(png, {
  [meta.PARAMETERS_KEY]: meta.formatA1111Parameters(record),
  [meta.LATENTRY_KEY]: JSON.stringify(record),
})
png = meta.writePngText(png, { [meta.TAGS_KEY]: JSON.stringify([{ name: 'smile', score: 0.9, category: 0 }]) })

mkdirSync(out, { recursive: true })
writeFileSync(path.join(out, 'settings.json'), JSON.stringify(checked.settings, null, 2) + '\n')
writeFileSync(path.join(out, 'picture.png'), png)
console.log(`${release}: settings ${Object.keys(checked.settings).join(', ')}; record ${Object.keys(record).length} fields`)
