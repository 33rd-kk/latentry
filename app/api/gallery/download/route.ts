import { jsonError, readJson } from '@/lib/api'
import { dirFor } from '@/lib/gallery/access'
import { openInDir } from '@/lib/gallery/fs'
import { attachment, zipStore, type ZipEntry } from '@/lib/gallery/zip'
import { serverMessage } from '@/lib/i18n/core'
import { stripMetadata } from '@/lib/image-meta'
import { MAX_DOWNLOADS_AT_ONCE } from '@/lib/limits'
import { tryEnter } from '@/lib/security/concurrency'

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
  const dir = dirFor(request.headers, typeof body?.dir === 'number' ? body.dir : undefined)
  if (!dir) return jsonError('Not found', 404)
  const names: unknown[] = Array.isArray(body?.names) ? body.names : []
  if (!names.length || names.length > MAX_DOWNLOAD_PICTURES || !names.every((name) => typeof name === 'string')) {
    return jsonError(serverMessage('gallery.download.tooMany', { count: MAX_DOWNLOAD_PICTURES }), 400)
  }
  const clean = body?.clean !== false

  const release = tryEnter('gallery:download', MAX_DOWNLOADS_AT_ONCE)
  if (!release) return jsonError(serverMessage('system.tooManyRequests', { seconds: 5 }), 429)
  try {
    return await zipped(dir, names as string[], clean)
  } finally {
    release()
  }
}

async function zipped(dir: NonNullable<ReturnType<typeof dirFor>>, names: string[], clean: boolean): Promise<Response> {
  const entries: ZipEntry[] = []
  let total = 0
  let leftOut = 0
  for (const name of new Set(names)) {
    const opened = await openInDir(dir, name)
    if (!opened) {
      leftOut += 1
      continue
    }
    let bytes: Buffer
    try {
      // By its size on disk, before reading it: a file far past the limit is never read.
      if (total + Number(opened.info.size) > MAX_DOWNLOAD_BYTES) return jsonError(serverMessage('gallery.download.tooLarge'), 413)
      bytes = await opened.handle.readFile()
    } finally {
      await opened.handle.close()
    }
    const data = clean ? stripMetadata(bytes) : bytes
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
