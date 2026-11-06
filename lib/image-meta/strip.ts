// SPDX-License-Identifier: MIT
//
// A picture without what describes how it was made, for sharing: the prompt,
// seed, LoRAs and workflow that Latentry, A1111 / Forge and ComfyUI write,
// and the EXIF and XMP other tools add (camera, place, software, dates).
// The pixels are not decoded or encoded again: only metadata blocks are left
// out, so nothing is lost and the colours stay as they were.
//
//   PNG   tEXt, zTXt, iTXt (every text chunk), eXIf, tIME go; the colour
//         chunks (iCCP, sRGB, gAMA, cHRM) and every other chunk stay.
//   JPEG  APP1 (EXIF, XMP), APP13 (Photoshop, IPTC) and COM go; JFIF, the
//         colour profile (APP2) and Adobe's colour transform (APP14) stay.
//         A rotation in the EXIF is kept, alone, so the picture still shows
//         the right way up.
//   WebP  the EXIF and XMP chunks go, and VP8X no longer says they are there.
//
// Content Credentials (C2PA: PNG caBX, JPEG APP11) are left as they are: they
// say where a picture came from, which is not this file's to take away.
//
// A file that cannot be read with confidence is refused (null), never passed
// on with its metadata.
//
// Part of lib/image-meta: no imports outside node's built-ins (see README.md).

import { isPng } from './png'
import { stripPngBytes } from './png-strip'

/** The PNG without its text, EXIF and time chunks; null when it is not a well-formed PNG. */
export function stripPng(png: Buffer): Buffer | null {
  const clean = stripPngBytes(png)
  return clean && Buffer.from(clean.buffer, clean.byteOffset, clean.byteLength)
}

const ORIENTATION_TAG = 0x0112

/** The EXIF orientation (2–8) in an APP1 Exif block; null when it is 1, missing or unreadable. */
export function exifOrientation(app1: Buffer): number | null {
  if (app1.length < 14 || app1.toString('latin1', 0, 6) !== 'Exif\0\0') return null
  const tiff = app1.subarray(6)
  const little = tiff.toString('latin1', 0, 2) === 'II'
  if (!little && tiff.toString('latin1', 0, 2) !== 'MM') return null
  const u16 = (at: number) => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at))
  const u32 = (at: number) => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at))
  if (tiff.length < 8 || u16(2) !== 42) return null
  const ifd = u32(4)
  if (ifd + 2 > tiff.length) return null
  const count = u16(ifd)
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12
    if (entry + 12 > tiff.length) return null
    if (u16(entry) === ORIENTATION_TAG) {
      const value = u16(entry + 8)
      return value >= 2 && value <= 8 ? value : null
    }
  }
  return null
}

/** An APP1 segment holding only an orientation. */
function orientationSegment(orientation: number): Buffer {
  // "Exif\0\0", a little-endian TIFF header, one IFD with one SHORT entry, no next IFD.
  const tiff = Buffer.alloc(8 + 2 + 12 + 4)
  tiff.write('II', 0, 'latin1')
  tiff.writeUInt16LE(42, 2)
  tiff.writeUInt32LE(8, 4)
  tiff.writeUInt16LE(1, 8)
  tiff.writeUInt16LE(ORIENTATION_TAG, 10)
  tiff.writeUInt16LE(3, 12)
  tiff.writeUInt32LE(1, 14)
  tiff.writeUInt16LE(orientation, 18)
  const data = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff])
  const head = Buffer.from([0xff, 0xe1, 0, 0])
  head.writeUInt16BE(data.length + 2, 2)
  return Buffer.concat([head, data])
}

const JPEG_DROP = new Set([0xe1, 0xed, 0xfe])

/** The JPEG without EXIF, XMP, IPTC and comments (an orientation kept); null when it cannot be read. */
export function stripJpeg(jpeg: Buffer): Buffer | null {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return null
  const parts: Buffer[] = [jpeg.subarray(0, 2)]
  let orientation: number | null = null
  let position = 2
  while (position < jpeg.length) {
    if (jpeg[position] !== 0xff) return null
    const marker = jpeg[position + 1]
    if (marker === undefined) return null
    // Fill bytes before a marker.
    if (marker === 0xff) {
      position += 1
      continue
    }
    // Markers without a length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(jpeg.subarray(position, position + 2))
      position += 2
      continue
    }
    // An image without a scan has nothing worth sending.
    if (marker === 0xd9) return null
    if (position + 4 > jpeg.length) return null
    const length = jpeg.readUInt16BE(position + 2)
    const end = position + 2 + length
    if (length < 2 || end > jpeg.length) return null
    if (marker === 0xda) {
      // The start of scan: from here on is the picture itself, kept whole.
      // A rotation goes right after JFIF (APP0), where readers look first.
      if (orientation !== null) {
        const afterJfif = parts.length > 1 && parts[1][1] === 0xe0 ? 2 : 1
        parts.splice(afterJfif, 0, orientationSegment(orientation))
      }
      parts.push(jpeg.subarray(position))
      return Buffer.concat(parts)
    }
    if (JPEG_DROP.has(marker)) {
      if (marker === 0xe1 && orientation === null) orientation = exifOrientation(jpeg.subarray(position + 4, end))
    } else {
      parts.push(jpeg.subarray(position, end))
    }
    position = end
  }
  return null
}

const WEBP_DROP = new Set(['EXIF', 'XMP '])
// VP8X's flags: bit 3 says there is EXIF, bit 2 XMP.
const VP8X_EXIF = 0x08
const VP8X_XMP = 0x04

/** The WebP without its EXIF and XMP chunks; null when it is not a well-formed WebP. */
export function stripWebp(webp: Buffer): Buffer | null {
  if (webp.length < 20 || webp.toString('latin1', 0, 4) !== 'RIFF' || webp.toString('latin1', 8, 12) !== 'WEBP') return null
  const riffEnd = 8 + webp.readUInt32LE(4)
  if (riffEnd > webp.length) return null
  const parts: Buffer[] = []
  let position = 12
  while (position + 8 <= riffEnd) {
    const fourcc = webp.toString('latin1', position, position + 4)
    const length = webp.readUInt32LE(position + 4)
    const end = position + 8 + length + (length % 2)
    if (end > riffEnd + (length % 2)) return null
    if (!WEBP_DROP.has(fourcc)) {
      const chunk = Buffer.from(webp.subarray(position, Math.min(end, webp.length)))
      if (fourcc === 'VP8X' && length >= 1) chunk[8] &= ~(VP8X_EXIF | VP8X_XMP)
      parts.push(chunk)
    }
    position = end
  }
  if (position < riffEnd) return null
  const body = Buffer.concat(parts)
  const head = Buffer.alloc(12)
  head.write('RIFF', 0, 'latin1')
  head.writeUInt32LE(4 + body.length, 4)
  head.write('WEBP', 8, 'latin1')
  return Buffer.concat([head, body])
}

/** Any of the three, by its first bytes; null for another format or a file that cannot be read. */
export function stripMetadata(bytes: Buffer): Buffer | null {
  if (isPng(bytes)) return stripPng(bytes)
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return stripJpeg(bytes)
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return stripWebp(bytes)
  return null
}
