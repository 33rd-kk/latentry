import { NextRequest, NextResponse } from 'next/server'
import { adapterOr404, jsonError } from '@/lib/api'
import { encodeSseEvent } from '@/lib/diffusion/sse'
import { getJob, subscribe, toSnapshot, type Job } from '@/lib/diffusion/job-store'
import { serverMessage } from '@/lib/i18n/core'
import { sseSlot } from '@/lib/security/request-budget'

export const runtime = 'nodejs'

// Some proxies drop a connection that has been silent for a while, and a run at
// high step counts can be, between two images. A comment line keeps it warm
// without the client having to treat it as an event.
const KEEPALIVE_MS = 20 * 1000

/**
 * Live view of one run. Any number of connections may watch it, and each one
 * starts with a full snapshot, so a reload or a second tab picks the run up
 * exactly where it is.
 *
 * Events sent to the browser:
 *   snapshot — the whole job, images included; first on every (re)connect
 *   progress — completed/total, the step within the current image, and the
 *              gallery file name of each image once it is saved
 *   image    — one finished image, with the index it belongs at
 *   end      — the run is over ("done" / "cancelled" / "error"), or "gone" when
 *              the job has been superseded or the server restarted. Waits for
 *              any save still being written, so its verdict is in it.
 */
export async function GET(request: NextRequest, ctx: RouteContext<'/api/gen/[backend]/job/stream'>) {
  const adapter = adapterOr404((await ctx.params).backend)
  if (adapter instanceof NextResponse) return adapter
  const backend = adapter.config.id

  const id = request.nextUrl.searchParams.get('id')
  if (!id) return jsonError('id is required', 400)

  // Every connection stays open as long as its tab does; a cap per client keeps
  // a reconnect loop or a pile of forgotten tabs from holding them all.
  const slot = sseSlot(request.headers, process.env)
  if (!slot) {
    return NextResponse.json(
      { error: serverMessage('system.tooManyStreams') },
      { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': '5' } }
    )
  }
  const releaseSlot = slot
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      let unsubscribe: () => void = () => {}
      let keepAlive: ReturnType<typeof setInterval> | null = null
      // How much of the job this connection has been told about, so a
      // reconnect re-sends the snapshot and then only what is genuinely new.
      let sentImages = 0
      let lastProgress = ''

      const send = (event: string, data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(encodeSseEvent(event, data)))
        } catch {
          close()
        }
      }

      function close() {
        if (closed) return
        closed = true
        releaseSlot()
        unsubscribe()
        if (keepAlive) clearInterval(keepAlive)
        request.signal.removeEventListener('abort', close)
        try {
          controller.close()
        } catch {
          // Already closed by the runtime.
        }
      }

      const progressOf = (job: Job) => ({
        completed: job.completed,
        total: job.total,
        currentStep: job.currentStep,
        stepsPerImage: job.stepsPerImage,
        // A save finishing fills in a name on an image already sent.
        savedNames: job.images.map((image) => image.saved_name),
      })

      const ended = (job: Job) => job.status !== 'running' && job.pendingSaves === 0
      const sendEnd = (job: Job) => send('end', { status: job.status, error: job.error, saveError: job.saveError })

      const push = () => {
        const job = getJob(backend, id)
        // A newer run having replaced this one reads the same as the server
        // having forgotten it.
        if (!job) {
          send('end', { status: 'gone', error: null })
          close()
          return
        }
        while (sentImages < job.images.length) {
          const index = sentImages
          sentImages += 1
          send('image', { index, ...job.images[index] })
        }
        const progress = progressOf(job)
        const key = JSON.stringify(progress)
        if (key !== lastProgress) {
          lastProgress = key
          send('progress', progress)
        }
        if (ended(job)) {
          sendEnd(job)
          close()
        }
      }

      const job = getJob(backend, id)
      if (!job) {
        send('end', { status: 'gone', error: null })
        close()
        return
      }

      send('snapshot', toSnapshot(job, { includeImages: true }))
      sentImages = job.images.length
      lastProgress = JSON.stringify(progressOf(job))
      if (ended(job)) {
        sendEnd(job)
        close()
        return
      }

      unsubscribe = subscribe(backend, id, push)
      request.signal.addEventListener('abort', close)
      keepAlive = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(': keep-alive\n\n'))
        } catch {
          close()
        }
      }, KEEPALIVE_MS)
    },
    cancel() {
      releaseSlot()
    },
  })

  return new NextResponse(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      // Stops nginx-style proxies from buffering the stream into silence.
      'X-Accel-Buffering': 'no',
    },
  })
}
