// Reading back how many entries a ZIP from zip.ts holds. Apart from zip.ts so
// the browser can use it without Node's zlib.

/**
 * The entry count in a ZIP's end record; null when the bytes do not end with
 * one (zip.ts never writes an archive comment, so the record is the last 22
 * bytes). The gallery's download tells from it how many pictures were left
 * out, since the server knows that only once the last one is sent.
 */
export function zipEntryCount(zip: Uint8Array): number | null {
  if (zip.length < 22) return null
  const view = new DataView(zip.buffer, zip.byteOffset + zip.length - 22, 22)
  return view.getUint32(0, true) === 0x06054b50 ? view.getUint16(10, true) : null
}
