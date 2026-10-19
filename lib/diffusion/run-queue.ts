import { randomUUID } from 'node:crypto'
import { getAdapter } from '@/lib/backends'
import type { Outcome } from '@/lib/backends/types'
import { getCurrentJob, onBackendIdle } from '@/lib/diffusion/job-store'
import { inputBytes, launchRun, type RunInput } from '@/lib/diffusion/launch'
import { serverMessage } from '@/lib/i18n/core'
import { QUEUE_MAX_BYTES, QUEUE_MAX_RUNS } from '@/lib/limits'
import { tryAcquire } from '@/lib/security/concurrency'

/**
 * Runs asked for while the backend is busy wait here, one queue per backend,
 * and start in turn as each run ends.
 *
 * Like the job store, the queue lives only in this server's memory: nothing of
 * a waiting run (its prompt, its pictures) is written anywhere, and a restart
 * drops the queue. Only the page that queued a run is told its id, so only
 * that page may watch it, cancel it, or make it secret; any other page is told
 * how many runs are waiting and nothing else (queueLength).
 *
 * A queued run keeps its id when it starts: it becomes the backend's current
 * job under the same id, so the page watching it goes on watching.
 */

export type QueuedState = 'queued' | 'started' | 'cancelled' | 'error'

export interface QueuedRun {
  id: string
  backend: string
  state: QueuedState
  error: string | null
  /**
   * The backend said it was busy with a run this server did not start
   * (another client on the web UI, say); it is asked again every RETRY_MS
   * until WAIT_MAX_MS have passed.
   */
  waitingSince: number | null
  /** The request, held only while the run waits; dropped once it leaves the queue. */
  input: RunInput | null
  /** Cancelled while it was being handed to the backend: stop it once it has started. */
  cancelOnStart: boolean
  enqueuedAt: number
  listeners: Set<() => void>
}

/** How often a backend that is busy with someone else's run is asked again. */
export const RETRY_MS = 3 * 1000
/** How long a run waits on a backend busy with someone else's run before it gives up. */
export const WAIT_MAX_MS = 30 * 60 * 1000
// A run that has just ended may still hold its backend for a moment (the
// adapter lets go after its last event), and the start lock for as long as a
// request is being handed over.
const SHORT_RETRY_MS = 250

// On globalThis for the same reason as the job store: a hot reload must not
// orphan runs that are waiting.
const globalForQueue = globalThis as typeof globalThis & {
  __latentryQueue?: Map<string, QueuedRun[]>
  __latentryQueueTimers?: Map<string, ReturnType<typeof setTimeout>>
}
const queues = (globalForQueue.__latentryQueue ??= new Map<string, QueuedRun[]>())
const timers = (globalForQueue.__latentryQueueTimers ??= new Map<string, ReturnType<typeof setTimeout>>())

function listOf(backend: string): QueuedRun[] {
  let list = queues.get(backend)
  if (!list) {
    list = []
    queues.set(backend, list)
  }
  return list
}

/** How many runs wait behind this backend's current one. */
export function queueLength(backend: string): number {
  return queues.get(backend)?.length ?? 0
}

/** The waiting run with this id, while it still waits. */
export function getQueued(backend: string, id: string): QueuedRun | null {
  return queues.get(backend)?.find((run) => run.id === id) ?? null
}

/** Its place in the queue: 1 is the next to start, 0 once it has left. */
export function positionOf(run: QueuedRun): number {
  return (queues.get(run.backend)?.indexOf(run) ?? -1) + 1
}

function notify(run: QueuedRun): void {
  for (const listener of run.listeners) {
    try {
      listener()
    } catch (error) {
      console.error('Queue listener failed:', error)
    }
  }
}

/** Everyone waiting behind this backend moved up, or the queue changed: tell them. */
function notifyAll(backend: string): void {
  for (const run of queues.get(backend) ?? []) notify(run)
}

/** Listens for any change on a waiting run, including its leaving the queue. */
export function subscribeQueued(run: QueuedRun, listener: () => void): () => void {
  run.listeners.add(listener)
  return () => {
    run.listeners.delete(listener)
  }
}

/** Puts a run at the back of the queue, or says why it cannot wait. */
export function enqueue(backend: string, input: RunInput): Outcome<QueuedRun> {
  const list = listOf(backend)
  if (list.length >= QUEUE_MAX_RUNS) return { ok: false, status: 409, error: serverMessage('system.queueFull', { max: QUEUE_MAX_RUNS }) }
  const bytes = list.reduce((sum, run) => sum + (run.input ? inputBytes(run.input) : 0), inputBytes(input))
  if (bytes > QUEUE_MAX_BYTES) return { ok: false, status: 409, error: serverMessage('system.queueTooLarge') }
  const run: QueuedRun = {
    id: randomUUID(),
    backend,
    state: 'queued',
    error: null,
    waitingSince: null,
    input,
    cancelOnStart: false,
    enqueuedAt: Date.now(),
    listeners: new Set(),
  }
  list.push(run)
  notifyAll(backend)
  return { ok: true, value: run }
}

function leave(run: QueuedRun, state: Exclude<QueuedState, 'queued'>, error: string | null = null): void {
  const list = queues.get(run.backend)
  const index = list?.indexOf(run) ?? -1
  if (index >= 0) list!.splice(index, 1)
  if (list?.length === 0) queues.delete(run.backend)
  run.state = state
  run.error = error
  // Its prompt and pictures go with it.
  run.input = null
  notify(run)
  notifyAll(run.backend)
}

/**
 * Takes a waiting run out of the queue. One being handed to the backend at
 * this moment is stopped as soon as it has started instead.
 */
export function cancelQueued(run: QueuedRun): void {
  if (run.state !== 'queued') return
  if (launching.has(run)) {
    run.cancelOnStart = true
    return
  }
  leave(run, 'cancelled')
}

/** Secret mode was turned on while this run waited: it starts as a secret run. One way, as markSecret. */
export function markQueuedSecret(run: QueuedRun): void {
  if (run.input) run.input.secret = true
}

const launching = new Set<QueuedRun>()
const retried = new WeakSet<QueuedRun>()

function later(backend: string, ms: number): void {
  if (timers.has(backend)) return
  const timer = setTimeout(() => {
    timers.delete(backend)
    pump(backend)
  }, ms)
  timer.unref?.()
  timers.set(backend, timer)
}

/**
 * Starts the next waiting run if the backend is free. Safe to call any time:
 * it does nothing while a run is going, and the start lock keeps it from
 * racing the generate route.
 */
export function pump(backend: string): void {
  void next(backend).catch((error: unknown) => console.error(`[${backend}] queue failed:`, error))
}

async function next(backend: string): Promise<void> {
  const head = queues.get(backend)?.[0]
  if (!head || launching.has(head)) return
  if (getCurrentJob(backend)?.status === 'running') return
  const release = tryAcquire(`gen:start:${backend}`)
  if (!release) return later(backend, SHORT_RETRY_MS)
  launching.add(head)
  try {
    const adapter = getAdapter(backend)
    if (!adapter || !head.input) {
      leave(head, 'error', 'This backend is no longer set up')
      return later(backend, 0)
    }
    const result = await launchRun(adapter, head.input, head.id)
    if (!result.ok) {
      const now = Date.now()
      // Busy: someone else's run on the web UI, or our last run letting go.
      if (result.status === 409 && !head.cancelOnStart) {
        // The first refusal is usually our own last run letting go.
        if (!retried.has(head)) {
          retried.add(head)
          return later(backend, SHORT_RETRY_MS)
        }
        if (head.waitingSince === null) {
          head.waitingSince = now
          notify(head)
        }
        if (now - head.waitingSince < WAIT_MAX_MS) return later(backend, RETRY_MS)
      }
      leave(head, head.cancelOnStart ? 'cancelled' : 'error', head.cancelOnStart ? null : result.error)
      return later(backend, 0)
    }
    leave(head, 'started')
    if (head.cancelOnStart) await adapter.cancel(result.value.runId).catch(() => null)
  } finally {
    launching.delete(head)
    release()
  }
}

onBackendIdle(pump)
