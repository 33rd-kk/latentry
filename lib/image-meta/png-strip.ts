// SPDX-License-Identifier: MIT
//
// A PNG without its text, EXIF and time chunks, on plain bytes: no imports at
// all, so the browser can clean a picture it already holds and nothing is
// sent anywhere for it. strip.ts uses the same function on the server.
//
// Every chunk that stays is copied as it was, its CRC included, so the
// pixels and the colour chunks (iCCP, sRGB, gAMA, cHRM) are untouched.
//
// Part of lib/image-meta (see README.md).

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME'])

function typeAt(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3])
}

/** The PNG without its text, EXIF and time chunks; null when it is not a well-formed PNG. */
export function stripPngBytes(png: Uint8Array): Uint8Array | null {
  if (png.length < 8 || SIGNATURE.some((byte, i) => png[i] !== byte)) return null
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  const kept: Array<[number, number]> = []
  let size = 8
  let offset = 8
  let first: string | null = null
  let last: string | null = null
  while (offset + 12 <= png.length) {
    const end = offset + 12 + view.getUint32(offset)
    const type = typeAt(png, offset + 4)
    if (end > png.length) return null
    first ??= type
    last = type
    if (!DROP.has(type)) {
      kept.push([offset, end])
      size += end - offset
    }
    offset = end
    if (type === 'IEND') break
  }
  if (first !== 'IHDR' || last !== 'IEND') return null
  const out = new Uint8Array(size)
  out.set(SIGNATURE)
  let at = 8
  for (const [start, end] of kept) {
    out.set(png.subarray(start, end), at)
    at += end - start
  }
  return out
}
