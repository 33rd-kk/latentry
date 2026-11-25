import { jsonError, readJson } from '@/lib/api'
import { dirFor } from '@/lib/gallery/access'
import { openInDir } from '@/lib/gallery/fs'
import { attachment, ZipWriter, type ZipEntry } from '@/lib/gallery/zip'
import { serverMessage } from '@/lib/i18n/core'
import { cleanCopy } from '@/lib/images/hidden-settings'
import { DOWNLOAD_IDLE_MS, MAX_DOWNLOADS_AT_ONCE } from '@/lib/limits'
import { tryEnter } from '@/lib/security/concurrency'

export const runtime = 'nodejs'

/** Pictures in one download, and their size in all. */
const MAX_DOWNLOAD_PICTURES = 200
const MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024

type Dir = NonNullable<ReturnType<typeof dirFor>>

/**
 * Several pictures of one gallery folder as a ZIP: `{ dir, names, clean }`.
 * With `clean` (the default) each goes without its settings
 * (lib/image-meta/strip.ts); one that cannot be cleaned is left out, never
 * sent with them. Entries carry the file names only, no folder, and no dates.
 *
 * The ZIP is sent a picture at a time, read only as the reader asks for more,
 * so the server holds about one picture, not the whole archive. What can be
 * known before the first byte is answered as before: 413 by the sizes on disk,
 * 422 when no picture can be saved. Pictures left out after that are not in
 * a header: the browser counts the entries the ZIP ends with
 * (lib/gallery/zip-count.ts).
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

  const enter = tryEnter('gallery:download', MAX_DOWNLOADS_AT_ONCE)
  if (!enter) return jsonError(serverMessage('system.tooManyRequests', { seconds: 5 }), 429)
  let released = false
  const release = () => {
    if (released) return
    released = true
    enter()
  }
  try {
    return await zipped(dir, [...new Set(names as string[])], clean, release, request.signal)
  } catch (error) {
    release()
    throw error
  }
}

/** One picture as it goes in the ZIP, or null when it is gone, unreadable or cannot be cleaned. */
async function prepared(dir: Dir, name: string, clean: boolean): Promise<Buffer | null> {
  const opened = await openInDir(dir, name)
  if (!opened) return null
  let bytes: Buffer
  try {
    bytes = await opened.handle.readFile()
  } catch (error) {
    console.error('Could not read a picture for a download:', error instanceof Error ? error.message : error)
    return null
  } finally {
    await opened.handle.close()
  }
  return clean ? cleanCopy(bytes) : bytes
}

/**
 * The ZIP response; `release` is called once it is over (sent, cancelled,
 * failed, idle, or answered with an error before it started).
 */
async function zipped(dir: Dir, names: string[], clean: boolean, release: () => void, signal: AbortSignal): Promise<Response> {
  // By the sizes on disk, before reading anything: a request far past the limit is never read.
  let onDisk = 0
  const queue: string[] = []
  for (const name of names) {
    const opened = await openInDir(dir, name)
    if (!opened) continue
    try {
      onDisk += Number(opened.info.size)
    } finally {
      await opened.handle.close()
    }
    if (onDisk > MAX_DOWNLOAD_BYTES) {
      release()
      return jsonError(serverMessage('gallery.download.tooLarge'), 413)
    }
    queue.push(name)
  }

  // A cleaned copy can come out larger than the file; one that would pass the limit is left out.
  let total = 0
  const next = async (): Promise<ZipEntry | null> => {
    for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
      const data = await prepared(dir, name, clean)
      if (!data || total + data.length > MAX_DOWNLOAD_BYTES) continue
      total += data.length
      return { name, data }
    }
    return null
  }

  let pending = await next()
  if (!pending) {
    release()
    return jsonError(serverMessage('gallery.download.noneSaved'), 422)
  }

  const writer = new ZipWriter()
  let idle: ReturnType<typeof setTimeout> | undefined
  let over = false
  const finish = () => {
    over = true
    clearTimeout(idle)
    release()
  }
  const stream = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        clearTimeout(idle)
        try {
          if (signal.aborted) throw new Error('The download was cancelled')
          const entry = pending ?? (await next())
          pending = null
          if (over) return
          if (!entry) {
            controller.enqueue(writer.end())
            controller.close()
            finish()
            return
          }
          for (const part of writer.entry(entry.name, entry.data)) controller.enqueue(part)
          // A reader that stops asking does not keep its place.
          idle = setTimeout(() => {
            if (over) return
            finish()
            controller.error(new Error('The download stopped being read'))
          }, DOWNLOAD_IDLE_MS)
          idle.unref?.()
        } catch (error) {
          if (over) return
          finish()
          controller.error(error)
        }
      },
      cancel() {
        finish()
      },
    },
    // Ask for the next picture only when the one before has been taken.
    { highWaterMark: 0 }
  )

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': attachment(clean ? 'latentry-pictures.zip' : 'latentry-pictures-with-settings.zip'),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
