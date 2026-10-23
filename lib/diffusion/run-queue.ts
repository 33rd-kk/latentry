import { randomUUID } from 'node:crypto'
import { getAdapter } from '@/lib/backends'
import type { Outcome } from '@/lib/backends/types'
import { getCurrentJob, getJob, keptForRun, markSecret, onBackendIdle } from '@/lib/diffusion/job-store'
import { inputBytes, isBusy, launchRun, type RunInput } from '@/lib/diffusion/launch'
import { cellRequest, gridPlace, type GridCell, type GridSpec } from '@/lib/generate/grid'
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
 *
 * An X/Y grid waits as one run too, and takes one place. When its turn comes
 * it stays at the front and starts its cells one after another, each as an
 * ordinary job with an id of its own, so nothing queued behind it runs in
 * between. It leaves the queue once its last cell has started.
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
  /** Set on an X/Y grid: `input` is then the run every cell starts from. */
  grid?: GridRun
}

export interface GridRun {
  spec: GridSpec
  cells: GridCell[]
  /** The next cell to start; cells.length once all have. */
  next: number
  /** Each started cell's job id, by cell index. */
  jobs: (string | null)[]
  /** Why a cell could not start, by cell index. */
  errors: (string | null)[]
  /** Kept apart from `input`, which is dropped when the grid leaves the queue. */
  secret: boolean
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
  __latentryGrids?: Map<string, QueuedRun>
}
const queues = (globalForQueue.__latentryQueue ??= new Map<string, QueuedRun[]>())
const timers = (globalForQueue.__latentryQueueTimers ??= new Map<string, ReturnType<typeof setTimeout>>())
// Grids that have left the queue, by id, so the page watching one can still
// follow and stop its last cell. Each is dropped when its cells' jobs would
// be (keptFor).
const leftGrids = (globalForQueue.__latentryGrids ??= new Map<string, QueuedRun>())

function listOf(backend: string): QueuedRun[] {
  let list = queues.get(backend)
  if (!list) {
    list = []
    queues.set(backend, list)
  }
  return list
}

/** How many runs wait behind this backend's current one. A grid counts as one. */
export function queueLength(backend: string): number {
  return queues.get(backend)?.length ?? 0
}

/**
 * How many runs wait that have not started at all, for other pages to see. A
 * grid drawing its cells stays in the queue (so nothing starts between them)
 * but is no longer waiting: the backend is simply busy with it.
 */
export function waitingCount(backend: string): number {
  return (queues.get(backend) ?? []).filter((run) => !run.grid || run.grid.next === 0).length
}

/** The waiting run with this id, while it still waits. */
export function getQueued(backend: string, id: string): QueuedRun | null {
  return queues.get(backend)?.find((run) => run.id === id) ?? null
}

/** A grid by its id: waiting, drawing its cells, or recently finished. */
export function getGrid(backend: string, id: string): QueuedRun | null {
  const run = getQueued(backend, id) ?? leftGrids.get(id) ?? null
  return run?.grid && run.backend === backend ? run : null
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

/**
 * Puts a run at the back of the queue, or says why it cannot wait. With
 * `grid`, the run is an X/Y grid and `input` the run its cells start from.
 */
export function enqueue(backend: string, input: RunInput, grid?: { spec: GridSpec; cells: GridCell[] }): Outcome<QueuedRun> {
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
    ...(grid
      ? {
          grid: {
            spec: grid.spec,
            cells: grid.cells,
            next: 0,
            jobs: grid.cells.map(() => null),
            errors: grid.cells.map(() => null),
            secret: input.secret,
          },
        }
      : {}),
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
  if (run.grid) keepGrid(run)
  notify(run)
  notifyAll(run.backend)
}

const gridTimers = new WeakMap<QueuedRun, ReturnType<typeof setTimeout>>()

/** A grid that has left the queue stays findable for as long as its cells' jobs do. */
function keepGrid(run: QueuedRun): void {
  leftGrids.set(run.id, run)
  const previous = gridTimers.get(run)
  if (previous) clearTimeout(previous)
  const timer = setTimeout(() => forgetGrid(run), keptForRun(run.grid!.secret))
  timer.unref?.()
  gridTimers.set(run, timer)
}

function forgetGrid(run: QueuedRun): void {
  if (leftGrids.get(run.id) !== run) return
  leftGrids.delete(run.id)
  // Its headings may be prompt text (prompt S/R).
  if (run.grid) {
    run.grid.spec = { x: { kind: run.grid.spec.x.kind, values: [], labels: [] }, y: null }
    run.grid.cells = []
  }
  notify(run)
}

/** The cell of this grid whose job is going on the backend now, if any. */
export function runningCell(run: QueuedRun): { index: number; job: string } | null {
  const current = getCurrentJob(run.backend)
  if (!run.grid || !current || current.status !== 'running') return null
  const index = run.grid.jobs.indexOf(current.id)
  return index >= 0 ? { index, job: current.id } : null
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

/**
 * Stops a grid: the cells not started yet are dropped, and the one going on
 * the backend is asked to stop, as Cancel does for any run.
 */
export async function cancelGrid(run: QueuedRun): Promise<void> {
  const going = runningCell(run)
  cancelQueued(run)
  if (!going) return
  const job = getJob(run.backend, going.job)
  await getAdapter(run.backend)
    ?.cancel(job?.runId ?? null)
    .catch(() => null)
}

/** Secret mode was turned on while this run waited: it starts as a secret run. One way, as markSecret. */
export function markQueuedSecret(run: QueuedRun): void {
  if (run.input) run.input.secret = true
  if (!run.grid || run.grid.secret) return
  run.grid.secret = true
  // The cells that have run are secret from now on too, and a grid that has
  // left the queue is forgotten as soon as a secret run would be.
  for (const id of run.grid.jobs) {
    const job = id ? getJob(run.backend, id) : null
    if (job) markSecret(job)
  }
  if (leftGrids.get(run.id) === run) keepGrid(run)
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
    const grid = head.grid
    const cell = grid?.cells[grid.next]
    const result = grid && cell ? await launchRun(adapter, cellInput(head.id, head.input, grid, cell)) : await launchRun(adapter, head.input, head.id)
    if (!result.ok) {
      const now = Date.now()
      // A 409 is not always "busy": Latentry's engine also says it for "no
      // model is loaded", which no amount of waiting fixes. Only a backend
      // that says it is busy (someone else's run on the web UI) is waited for.
      if (result.status === 409 && !head.cancelOnStart) {
        // The first refusal is usually our own last run letting go.
        if (!retried.has(head)) {
          retried.add(head)
          return later(backend, SHORT_RETRY_MS)
        }
      }
      if (result.status === 409 && !head.cancelOnStart && (await isBusy(adapter))) {
        if (head.waitingSince === null) {
          head.waitingSince = now
          notify(head)
        }
        if (now - head.waitingSince < WAIT_MAX_MS) return later(backend, RETRY_MS)
      }
      if (grid && cell && !head.cancelOnStart) {
        // One cell that cannot start does not stop the others.
        grid.errors[cell.index] = result.error
        nextCell(head, grid)
        return later(backend, 0)
      }
      leave(head, head.cancelOnStart ? 'cancelled' : 'error', head.cancelOnStart ? null : result.error)
      return later(backend, 0)
    }
    if (grid && cell) {
      grid.jobs[cell.index] = result.value.id
      if (head.cancelOnStart) {
        leave(head, 'cancelled')
        await adapter.cancel(result.value.runId).catch(() => null)
        return
      }
      // The next cell starts when this one ends (onBackendIdle).
      nextCell(head, grid)
      return
    }
    leave(head, 'started')
    if (head.cancelOnStart) await adapter.cancel(result.value.runId).catch(() => null)
  } finally {
    launching.delete(head)
    release()
  }
}

/** Moves a grid on to its next cell, or out of the queue after its last. */
function nextCell(run: QueuedRun, grid: GridRun): void {
  grid.next += 1
  retried.delete(run)
  run.waitingSince = null
  if (grid.next >= grid.cells.length) leave(run, 'started')
  else notify(run)
}

/** The run one cell of a grid draws, with where it sits in the grid for its pictures' record. */
function cellInput(id: string, base: RunInput, grid: GridRun, cell: GridCell): RunInput {
  const generate = cellRequest(base.generate, grid.spec, cell)
  const replaces = grid.spec.x.kind === 'prompt_sr' || grid.spec.y?.kind === 'prompt_sr'
  return {
    ...base,
    generate,
    // The template is the prompt as typed: it takes the same replacement, so the record matches what ran.
    promptTemplate:
      base.promptTemplate && replaces ? cellRequest({ ...base.generate, prompt: base.promptTemplate }, grid.spec, cell).prompt : base.promptTemplate,
    secret: base.secret || grid.secret,
    grid: gridPlace(id, grid.spec, cell),
  }
}

onBackendIdle(pump)
