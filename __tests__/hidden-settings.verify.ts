/**
 * lib/images/hidden-settings.ts: a copy of the settings hidden in a PNG's
 * pixels (NovelAI's alpha bits, the stealth extension's colour bits) is found
 * and taken out of a picture shared without settings; any other picture is
 * left as the same bytes.
 *
 * Run with: npm test -- hidden-settings
 */
import sharp from 'sharp'
import { check, done, eq } from './assert'
import { metaFromText, readPngText, writePngText } from '../lib/image-meta'
import { cleanCopy, hiddenKindIn, withoutHiddenSettings } from '../lib/images/hidden-settings'

const WIDTH = 24
const HEIGHT = 20

/** Raw pixels with `word` and a made-up payload hidden column by column in the alpha (or colour) bits. */
function hidden(word: string, channels: 3 | 4, where: 'alpha' | 'rgb'): Buffer {
  const data = Buffer.alloc(WIDTH * HEIGHT * channels)
  for (let at = 0; at < data.length; at += channels) {
    data[at] = 120
    data[at + 1] = 160
    data[at + 2] = 200
    if (channels === 4) data[at + 3] = 255
  }
  const bits = [...Buffer.from(`${word}{"prompt":"made up"}`, 'latin1')].flatMap((byte) => [7, 6, 5, 4, 3, 2, 1, 0].map((shift) => (byte >> shift) & 1))
  const offset = (pixel: number) => ((pixel % HEIGHT) * WIDTH + Math.floor(pixel / HEIGHT)) * channels
  bits.forEach((bit, i) => {
    const at = where === 'alpha' ? offset(i) + 3 : offset(Math.floor(i / 3)) + (i % 3)
    data[at] = (data[at] & 0xfe) | bit
  })
  return data
}

const png = (data: Buffer, channels: 3 | 4) => sharp(data, { raw: { width: WIDTH, height: HEIGHT, channels } }).png().toBuffer()
const raw = async (bytes: Buffer) => sharp(bytes).raw().toBuffer({ resolveWithObject: true })

async function main() {
  // ── NovelAI: the alpha bits ──
  for (const word of ['stealth_pngcomp', 'stealth_pnginfo']) {
    const source = hidden(word, 4, 'alpha')
    eq(hiddenKindIn(source, WIDTH, HEIGHT, 4), 'alpha', `${word}: found in the alpha bits`)
    const cleaned = await withoutHiddenSettings(await png(source, 4))
    const after = await raw(cleaned)
    eq([after.info.width, after.info.height, after.info.channels], [WIDTH, HEIGHT, 4], `${word}: same size and channels`)
    eq(hiddenKindIn(after.data, WIDTH, HEIGHT, 4), null, `${word}: gone from the copy`)
    check([...after.data].every((value, i) => Math.abs(value - source[i]) <= 1), `${word}: no value moved by more than 1`)
    check([...after.data].filter((_, i) => i % 4 === 3).every((alpha) => alpha === 255), `${word}: an opaque picture stays opaque`)
  }

  // ── The stealth extension: the colour bits ──
  const rgb = hidden('stealth_rgbinfo', 3, 'rgb')
  eq(hiddenKindIn(rgb, WIDTH, HEIGHT, 3), 'rgb', 'stealth_rgbinfo: found in the colour bits')
  const rgbAfter = await raw(await withoutHiddenSettings(await png(rgb, 3)))
  eq(hiddenKindIn(rgbAfter.data, WIDTH, HEIGHT, 3), null, 'stealth_rgbinfo: gone from the copy')
  check([...rgbAfter.data].every((value, i) => Math.abs(value - rgb[i]) <= 1), 'stealth_rgbinfo: no value moved by more than 1')

  // ── Anything else is left as it was ──
  const plain = await png(hidden('nothing_hidden!', 4, 'alpha'), 4)
  check((await withoutHiddenSettings(plain)).equals(plain), 'a PNG without the words comes back as the same bytes')
  const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#4080c0' } }).jpeg().toBuffer()
  check((await withoutHiddenSettings(jpeg)).equals(jpeg), 'a JPEG is not looked into')
  const palette = await sharp(hidden('stealth_pngcomp', 4, 'alpha'), { raw: { width: WIDTH, height: HEIGHT, channels: 4 } }).png({ palette: true }).toBuffer()
  check((await withoutHiddenSettings(palette)).equals(palette), 'a palette PNG is not looked into (the tools write 8-bit RGB or RGBA)')

  // ── The copy for sharing: no text chunks and no hidden copy ──
  const withText = writePngText(await png(hidden('stealth_pngcomp', 4, 'alpha'), 4), {
    Software: 'NovelAI',
    Comment: JSON.stringify({ prompt: 'made up', seed: 1 }),
  })
  eq(metaFromText(readPngText(withText))?.source, 'novelai', 'the made-up picture reads as NovelAI')
  const shared = await cleanCopy(withText)
  check(!!shared, 'it can be shared without settings')
  eq(Object.keys(readPngText(shared!)), [], 'the copy has no text chunks')
  eq(hiddenKindIn((await raw(shared!)).data, WIDTH, HEIGHT, 4), null, 'nor the hidden copy')
  check((await cleanCopy(plain))?.equals(plain) ?? false, 'a picture with nothing to take out is shared as it is')

  // A PNG that cannot be decoded is not shared unchecked.
  const broken = Buffer.concat([withText.subarray(0, 60), Buffer.alloc(40)])
  eq(await cleanCopy(broken), null, 'a broken PNG gives no copy, rather than one never checked')

  done('hidden-settings')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
