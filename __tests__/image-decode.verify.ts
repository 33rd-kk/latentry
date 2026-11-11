/**
 * Pictures from outside (lib/images/decode.ts): a picture larger than
 * MAX_INPUT_PIXELS is refused before it is decoded, wherever a source, mask
 * or result is read, and an ordinary one is not.
 *
 * Run with: npm test -- image-decode
 */
import { crc32 } from 'node:zlib'
import sharp from 'sharp'
import { check, done, eq } from './assert'
import { imageSize, letterboxedControl, preparedImages } from '../lib/backends/images'
import { controlPicture } from '../lib/control/annotators'
import { canvasOf } from '../lib/facefix/image'
import { prepareOutpaint } from '../lib/generate/outpaint-image'
import { decodeImage, fitsDecode, MAX_INPUT_PIXELS } from '../lib/images/decode'

/** A real PNG whose IHDR claims `width` × `height`: cheap to make, as costly to decode as that size. */
function claiming(png: Buffer, width: number, height: number): Buffer {
  const out = Buffer.from(png)
  out.writeUInt32BE(width, 16)
  out.writeUInt32BE(height, 20)
  out.writeUInt32BE(crc32(out.subarray(12, 29)) >>> 0, 29)
  return out
}

async function main(): Promise<void> {
  sharp.cache(false)
  eq(MAX_INPUT_PIXELS, 8192 * 8192, 'room for a 4x upscale of a 2048 picture')
  check(fitsDecode({ width: 8192, height: 8192 }) && !fitsDecode({ width: 8193, height: 8192 }), 'up to MAX_INPUT_PIXELS fits, one more row does not')
  check(!fitsDecode({}) && !fitsDecode({ width: 0, height: 10 }), 'nor does a picture with no size')

  const small = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#468' } }).png().toBuffer()
  const huge = claiming(small, 12000, 12000)
  eq((await sharp(huge).metadata()).width, 12000, "the test picture claims 12000 x 12000 (under sharp's own limit, past ours)")
  const refused = await decodeImage(huge).png().toBuffer().then(
    () => null,
    (error: unknown) => (error instanceof Error ? error.message : String(error))
  )
  check(!!refused && /pixel limit/i.test(refused), `decodeImage refuses it by its size, before decoding (${refused})`)

  const b64 = huge.toString('base64')
  eq(await imageSize(b64), null, 'a source that large has no usable size')
  eq(await preparedImages({ init_image_base64: b64, width: 1024, height: 1024 }, 8), null, 'so img2img for another backend refuses it')
  eq(await prepareOutpaint(b64, { left: 64, right: 0, top: 0, bottom: 0 }), null, 'and so does Extend')
  check(await canvasOf(b64).then(() => false, () => true), 'face fix refuses it as well')
  check(await controlPicture('canny', huge).then(() => false, () => true), 'and a control picture is not made from it')
  eq(await letterboxedControl(b64, 1024, 1024), null, 'nor sent to ComfyUI')

  // An ordinary picture is read as before.
  const ordinary = await sharp({ create: { width: 2048, height: 1536, channels: 3, background: '#468' } }).png().toBuffer()
  eq(await imageSize(ordinary.toString('base64')), { width: 2048, height: 1536 }, 'a 2048 picture has its size')
  eq((await decodeImage(ordinary).resize(32, 24).raw().toBuffer({ resolveWithObject: true })).info.width, 32, 'and decodes')
  eq((await canvasOf(ordinary.toString('base64'))).width, 2048, 'face fix reads it')
  eq((await sharp(await controlPicture('canny', ordinary)).metadata()).width, 1024, 'and Canny edges are made from it')
}

main()
  .then(() => done('image-decode'))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
