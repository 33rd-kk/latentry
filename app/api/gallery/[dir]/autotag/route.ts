import { jsonError, readJson } from '@/lib/api'
import { getTagger } from '@/lib/tagger'
import { getGalleryDirs } from '@/lib/gallery/dirs'
import { isSafeName, readInDir } from '@/lib/gallery/fs'
import { metaFromText, readPngText } from '@/lib/image-meta'
import { writeTags } from '@/lib/gallery/save'
import { tryAcquire } from '@/lib/security/concurrency'

export const runtime = 'nodejs'

const MAX_NAMES = 1000

/**
 * WD14-tags many pictures in the save folder and writes the tags into each.
 *
 *   POST { names: string[], skipTagged?: boolean }
 *
 * One request for the whole batch rather than one per picture: the per-IP
 * budget allows few POSTs a minute, and the pictures never have to travel to
 * the browser and back. The answer is newline-delimited JSON, a line per
 * picture as it is done, so the page can show progress:
 *
 *   {"name":"a.png","status":"tagged","tags":[...]}
 *   {"name":"b.png","status":"skipped"}            (already tagged, with skipTagged)
 *   {"name":"c.png","status":"failed","error":"..."}
 *   {"done":true,"tagged":1,"skipped":1,"failed":1}
 *
 * Closing the connection stops the batch after the picture in progress. One
 * batch at a time, since they would only queue on the same tagger.
 */
export async function POST(request: Request, ctx: RouteContext<'/api/gallery/[dir]/autotag'>) {
  const { dir: dirParam } = await ctx.params
  const dir = /^\d+$/.test(dirParam) ? getGalleryDirs()[Number(dirParam)] : undefined
  if (!dir) return jsonError('Not found', 404)
  if (!dir.writable) return jsonError('This folder is read-only', 403)

  const body = await readJson(request)
  const names = Array.isArray(body?.names) ? body.names.filter((name): name is string => typeof name === 'string' && isSafeName(name)) : []
  if (!names.length || names.length > MAX_NAMES) return jsonError(`names must list 1 to ${MAX_NAMES} pictures`, 400)
  const skipTagged = body?.skipTagged === true

  const tagger = await getTagger()
  if (!tagger) return jsonError('Nothing can tag pictures: set a WD14 model folder in Settings, or a backend with a tagger', 503)

  const release = tryAcquire('gallery:autotag')
  if (!release) return jsonError('Another batch is already being tagged', 409)

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (line: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(line) + '\n'))
        } catch {
          // The page went away; the loop notices through the signal.
        }
      }
      const counts = { tagged: 0, skipped: 0, failed: 0 }
      try {
        for (const name of names) {
          if (request.signal.aborted) break
          try {
            const picture = await readInDir(dir, name)
            if (!picture) {
              counts.failed += 1
              send({ name, status: 'failed', error: 'Not found' })
              continue
            }
            const { file, bytes } = picture
            if (skipTagged && file.toLowerCase().endsWith('.png') && metaFromText(readPngText(bytes))?.tags?.length) {
              counts.skipped += 1
              send({ name, status: 'skipped' })
              continue
            }
            const result = await tagger.tag(bytes.toString('base64'))
            if (!result.ok) throw new Error(result.error)
            const saved = await writeTags(dir, name, result.value.tags)
            if (!saved) throw new Error('Only PNG files can hold tags')
            counts.tagged += 1
            send({ name, status: 'tagged', tags: result.value.tags })
          } catch (error) {
            counts.failed += 1
            send({ name, status: 'failed', error: error instanceof Error ? error.message : String(error) })
          }
        }
        send({ done: true, ...counts, cancelled: request.signal.aborted })
      } finally {
        release()
        try {
          controller.close()
        } catch {
          // Already closed by the runtime.
        }
      }
    },
    cancel() {
      // The loop checks request.signal; nothing else to stop.
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' },
  })
}
