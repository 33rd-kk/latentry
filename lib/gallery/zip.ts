// A ZIP archive of pictures, stored without compression (pictures are already
// compressed). Just enough of the format for that: no ZIP64 (callers keep the
// total far below 4 GB), UTF-8 names, and no times: every entry is dated
// 1980-01-01, the format's earliest day, so the archive says nothing about
// when a picture was made.
//
// Pure, so the verify script can pin it down.

import { crc32 } from 'node:zlib'

export interface ZipEntry {
  name: string
  data: Buffer
}

const UTF8_NAMES = 0x0800
// DOS date for 1980-01-01: (year - 1980) << 9 | month << 5 | day.
const DOS_DATE = (1 << 5) | 1

export function zipStore(entries: ZipEntry[]): Buffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const { name, data } of entries) {
    const fileName = Buffer.from(name, 'utf8')
    const crc = crc32(data) >>> 0
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(UTF8_NAMES, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(fileName.length, 26)
    local.writeUInt16LE(0, 28)
    parts.push(local, fileName, data)

    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(20, 4)
    entry.writeUInt16LE(20, 6)
    entry.writeUInt16LE(UTF8_NAMES, 8)
    entry.writeUInt16LE(0, 10)
    entry.writeUInt16LE(0, 12)
    entry.writeUInt16LE(DOS_DATE, 14)
    entry.writeUInt32LE(crc, 16)
    entry.writeUInt32LE(data.length, 20)
    entry.writeUInt32LE(data.length, 24)
    entry.writeUInt16LE(fileName.length, 28)
    entry.writeUInt32LE(offset, 42)
    central.push(entry, fileName)
    offset += local.length + fileName.length + data.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, directory, end])
}

/** `attachment` with the file name, in ASCII for old readers and UTF-8 for the rest (RFC 6266). */
export function attachment(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}
