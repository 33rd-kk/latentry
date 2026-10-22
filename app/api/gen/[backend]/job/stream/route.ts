import { NextRequest, NextResponse } from 'next/server'
import { adapterOr404, jsonError } from '@/lib/api'
import { encodeSseEvent } from '@/lib/diffusion/sse'
import { getJob, isWatchable, subscribe, toSnapshot, type Job } from '@/lib/diffusion/job-store'
import { getGrid, getQueued, positionOf, subscribeQueued, type QueuedRun } from '@/lib/diffusion/run-queue'
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
 *   queued   — the run is still waiting: its place (1 is next), and whether the
 *              backend is busy with a run this server did not start. Then,
 *              once it starts, the events below, as for any run.
 *   snapshot — the whole job, images included; first on every (re)connect
 *   progress — completed/total, the step within the current image, and the
 *              gallery file name of each image once it is saved
 *   image    — one finished image, with the index it belongs at
 *   end      — the run is over ("done" / "cancelled" / "error"), or "gone" when
 *              the job has been forgotten or the server restarted. A run the
 *              next one has replaced is still watched to its end. Waits for
 *              any save still being written, so its verdict is in it.
 *
 * An X/Y grid's id is watched whole: `queued` while it waits, then for each
 * cell in order
 *   cell     — { index }: the cell's run starts (or has run, on a reconnect)
 *   snapshot / progress / image — that cell's run, as above
 *   cellEnd  — { index, status, error, saveError }: that cell is over
 * and one `end` for the grid ("done" / "cancelled" / "error" / "gone").
 */
export async function GET(request: NextRequest, ctx: RouteContext<'/api/gen/[backend]/job/stream'>) {
  const adapter = adapterOr404((await ctx.params).backend)
  if (adapter instanceof Response) return adapter
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
        // Forgotten, or the server restarted.
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

      const watchJob = () => {
        const job = getJob(backend, id)
        // Past its window a run is over for every viewer, not only for /job.
        if (!job || !isWatchable(job)) {
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
      }

      // A run still in the queue: its place until it starts, then the run itself.
      const waitInQueue = (run: QueuedRun) => {
        let lastPlace = ''
        const update = () => {
          if (run.state === 'queued') {
            const place = { position: positionOf(run), waiting: run.waitingSince !== null }
            const key = JSON.stringify(place)
            if (key !== lastPlace) {
              lastPlace = key
              send('queued', place)
            }
            return
          }
          unsubscribe()
          if (run.state === 'started') return watchJob()
          send('end', { status: run.state, error: run.error })
          close()
        }
        unsubscribe = subscribeQueued(run, update)
        update()
      }

      // An X/Y grid: its place while it waits, then each cell in turn.
      const watchGrid = (run: QueuedRun) => {
        const grid = run.grid!
        let lastPlace = ''
        // The cell being told about, or last told about.
        let index = -1
        let offCell: (() => void) | null = null

        const endCell = (status: string, error: string | null, saveError: string | null) => {
          offCell?.()
          offCell = null
          send('cellEnd', { index, status, error, saveError })
        }
        const pushCell = (jobId: string) => {
          const job = getJob(backend, jobId)
          if (!job) {
            endCell('gone', null, null)
            return update()
          }
          while (sentImages < job.images.length) {
            const at = sentImages
            sentImages += 1
            send('image', { index: at, ...job.images[at] })
          }
          const progress = progressOf(job)
          const key = JSON.stringify(progress)
          if (key !== lastProgress) {
            lastProgress = key
            send('progress', progress)
          }
          if (ended(job)) {
            endCell(job.status, job.error, job.saveError)
            update()
          }
        }
        const startCell = (jobId: string) => {
          send('cell', { index })
          const job = getJob(backend, jobId)
          if (!job) return endCell('gone', null, null)
          send('snapshot', toSnapshot(job, { includeImages: true }))
          sentImages = job.images.length
          lastProgress = JSON.stringify(progressOf(job))
          if (ended(job)) return endCell(job.status, job.error, job.saveError)
          offCell = subscribe(backend, jobId, () => pushCell(jobId))
        }
        const finishGrid = (status: string, error: string | null) => {
          send('end', { status, error })
          close()
        }
        function update() {
          while (!closed && !offCell) {
            const at = index + 1
            // Forgotten: its cells went with it.
            if (grid.cells.length === 0) return finishGrid('gone', null)
            if (at >= grid.cells.length) return finishGrid(run.state === 'cancelled' ? 'cancelled' : 'done', null)
            const jobId = grid.jobs[at]
            const error = grid.errors[at]
            if (jobId || error) {
              index = at
              if (jobId) startCell(jobId)
              else {
                send('cell', { index })
                send('cellEnd', { index, status: 'error', error, saveError: null })
              }
              continue
            }
            // Cancelled, or gave up on a busy backend, before this cell.
            if (run.state !== 'queued') return finishGrid(run.state === 'started' ? 'done' : run.state, run.error)
            // Not started yet: its place, until its first cell starts.
            if (index === -1) {
              const place = { position: positionOf(run), waiting: run.waitingSince !== null }
              const key = JSON.stringify(place)
              if (key !== lastPlace) {
                lastPlace = key
                send('queued', place)
              }
            }
            return
          }
        }
        const offRun = subscribeQueued(run, update)
        unsubscribe = () => {
          offRun()
          offCell?.()
        }
        update()
      }

      const grid = getGrid(backend, id)
      const queued = grid ? null : getQueued(backend, id)
      if (grid) watchGrid(grid)
      else if (queued) waitInQueue(queued)
      else watchJob()
      if (closed) return

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
