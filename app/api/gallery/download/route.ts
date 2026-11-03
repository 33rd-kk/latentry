import { jsonError, readJson } from '@/lib/api'
import { getGalleryDirs } from '@/lib/gallery/dirs'
import { readInDir } from '@/lib/gallery/fs'
import { attachment, zipStore, type ZipEntry } from '@/lib/gallery/zip'
import { serverMessage } from '@/lib/i18n/core'
import { stripMetadata } from '@/lib/image-meta'

export const runtime = 'nodejs'

/** Pictures in one download, and their size in all. */
const MAX_DOWNLOAD_PICTURES = 200
const MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024

/**
 * Several pictures of one gallery folder as a ZIP: `{ dir, names, clean }`.
 * With `clean` (the default) each goes without its settings
 * (lib/image-meta/strip.ts); one that cannot be cleaned is left out and
 * counted in `X-Latentry-Left-Out`, never sent with them. Entries carry the
 * file names only, no folder, and no dates.
 */
export async function POST(request: Request) {
  const body = await readJson(request)
  const dir = typeof body?.dir === 'number' && Number.isInteger(body.dir) ? getGalleryDirs()[body.dir] : undefined
  if (!dir) return jsonError('Not found', 404)
  const names: unknown[] = Array.isArray(body?.names) ? body.names : []
  if (!names.length || names.length > MAX_DOWNLOAD_PICTURES || !names.every((name) => typeof name === 'string')) {
    return jsonError(serverMessage('gallery.download.tooMany', { count: MAX_DOWNLOAD_PICTURES }), 400)
  }
  const clean = body?.clean !== false

  const entries: ZipEntry[] = []
  let total = 0
  let leftOut = 0
  for (const name of new Set(names as string[])) {
    const read = await readInDir(dir, name)
    if (!read) {
      leftOut += 1
      continue
    }
    const data = clean ? stripMetadata(read.bytes) : read.bytes
    if (!data) {
      leftOut += 1
      continue
    }
    total += data.length
    if (total > MAX_DOWNLOAD_BYTES) return jsonError(serverMessage('gallery.download.tooLarge'), 413)
    entries.push({ name, data })
  }
  if (!entries.length) return jsonError(serverMessage('gallery.download.noneSaved'), 422)

  return new Response(new Uint8Array(zipStore(entries)), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': attachment(clean ? 'latentry-pictures.zip' : 'latentry-pictures-with-settings.zip'),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Latentry-Left-Out': String(leftOut),
    },
  })
}
