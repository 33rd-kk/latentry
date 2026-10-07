import { randomUUID } from 'node:crypto'
import type { BackendEvent, GenerateRequest } from '@/lib/backends/types'

/**
 * Server-side record of the run each backend is doing, so the page can be
 * reloaded — or left and returned to from another tab — without losing the
 * progress and the images of a run that is still going.
 *
 * If the browser owned that state, anything that dropped its connection (a
 * reload, bfcache eviction, a backgrounded tab whose socket the browser
 * closed) would throw the run away while the GPU kept working on it. Instead
 * this server consumes the backend's events once into this record and the
 * page subscribes to it, so any number of reconnects — from any tab — see the
 * same run.
 *
 * One run per backend: a backend does one run at a time, and two backends
 * (say an Anima server and a Forge web UI on another GPU) can run side by side.
 * Only each backend's latest run is kept, images and all, and only until no
 * page may read it any more (keptFor). This lives in the memory of a single
 * `next start` / `next dev` process, which is what a local install is.
 */

export type JobStatus = 'running' | 'done' | 'cancelled' | 'error'

export interface JobImage {
  seed: number
  image_base64: string
  /** The file it was saved as in the gallery, once saved; null when saving is off or failed. */
  saved_name: string | null
}

/** What a subscriber is told about a job; images are left out where the caller only needs the numbers. */
export interface JobSnapshot {
  id: string
  backend: string
  status: JobStatus
  /** The backend's id for this run, sent back on cancel so a late click cannot stop a later run. */
  runId: string | null
  /** Images finished so far, and how many the run asked for. */
  completed: number
  total: number
  /** Denoising step within the image in progress (0 before the first one lands). */
  currentStep: number
  stepsPerImage: number
  imageCount: number
  images?: JobImage[]
  error: string | null
  /**
   * Why saving to the gallery did not work, if it did not. Separate from
   * `error`: the images exist and the run succeeded either way, but a folder
   * that cannot be written is a setting someone has to fix, so it is said.
   */
  saveError: string | null
  startedAt: number
  endedAt: number | null
}

type Listener = () => void

/** Everything the gallery needs to write the run's settings into each file. */
export interface JobContext {
  request: GenerateRequest
  profile: string
  kind: string
  model: string | null
  mode: 'txt2img' | 'img2img' | 'inpaint' | 'pose'
}

export interface Job extends Omit<JobSnapshot, 'imageCount' | 'images'> {
  images: JobImage[]
  listeners: Set<Listener>
  context: JobContext
  /**
   * Started in secret mode: only the page that started it, which knows the
   * id, may watch it. It is never offered to a page that loads, and it is
   * dropped from memory a short while after it ends (SECRET_GRACE_MS).
   */
  secret: boolean
  /**
   * Saves still being written. The run is over as far as generating goes, but
   * a stream that says goodbye while the last file is still being written would
   * take the save's verdict with it — on a one-image run, every time.
   */
  pendingSaves: number
}

/** Called for each finished image; resolves to the saved file name, or null. */
export type ImageSink = (job: Job, image: JobImage, index: number) => Promise<string | null>

/**
 * How long after a run ends the page still adopts its results on a fresh load:
 * a reload keeps the images on screen, the next morning starts clean.
 */
export const RESUME_WINDOW_MS = 60 * 60 * 1000

/**
 * How long a secret run is kept after it ends: enough for the page that
 * started it to receive the last images over a stream that dropped for a
 * moment, not enough for anyone to come back for them.
 */
export const SECRET_GRACE_MS = 60 * 1000

// Held on globalThis so `next dev`'s hot reload — which re-evaluates this
// module — cannot orphan a job a page is in the middle of watching.
const globalForJobs = globalThis as typeof globalThis & { __latentryJobs?: Map<string, Job> }
const jobs = (globalForJobs.__latentryJobs ??= new Map())

export function getCurrentJob(backend: string): Job | null {
  return jobs.get(backend) ?? null
}

/** The job with this id, but only while it is still its backend's current one. */
export function getJob(backend: string, id: string): Job | null {
  const job = getCurrentJob(backend)
  return job && job.id === id ? job : null
}

/** True while a stream that knows this run's id may still watch it. */
export function isWatchable(job: Job, now = Date.now()): boolean {
  if (job.status === 'running') return true
  return now - (job.endedAt ?? job.startedAt) < keptFor(job)
}

/** True while the page should still put this run back on screen after a reload. Never for a secret run. */
export function isResumable(job: Job, now = Date.now()): boolean {
  return !job.secret && isWatchable(job, now)
}

export function toSnapshot(job: Job, options: { includeImages?: boolean } = {}): JobSnapshot {
  return {
    id: job.id,
    backend: job.backend,
    status: job.status,
    runId: job.runId,
    completed: job.completed,
    total: job.total,
    currentStep: job.currentStep,
    stepsPerImage: job.stepsPerImage,
    imageCount: job.images.length,
    ...(options.includeImages ? { images: job.images } : {}),
    error: job.error,
    saveError: job.saveError,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
  }
}

function notify(job: Job): void {
  for (const listener of job.listeners) {
    try {
      listener()
    } catch (error) {
      console.error('Job listener failed:', error)
    }
  }
}

/**
 * Subscribes to any change on the job with this id. The listener also runs
 * when that job stops being current, so a stream watching a superseded run
 * notices and closes instead of hanging.
 */
export function subscribe(backend: string, id: string, listener: Listener): () => void {
  const job = getJob(backend, id)
  if (!job) return () => {}
  job.listeners.add(listener)
  return () => {
    job.listeners.delete(listener)
  }
}

/**
 * Replaces the backend's current job. `total` and `steps` are only a starting
 * guess for the progress bars; the backend's own events correct both.
 */
export function startJob(init: { backend: string; total: number; steps: number; context: JobContext; secret?: boolean }): Job {
  const previous = getCurrentJob(init.backend)
  const job: Job = {
    id: randomUUID(),
    backend: init.backend,
    status: 'running',
    runId: null,
    completed: 0,
    total: init.total,
    currentStep: 0,
    stepsPerImage: init.steps,
    images: [],
    error: null,
    saveError: null,
    pendingSaves: 0,
    startedAt: Date.now(),
    endedAt: null,
    listeners: new Set(),
    context: init.context,
    secret: init.secret === true,
  }
  jobs.set(init.backend, job)
  // Whoever still watched the old run is now watching nothing; wake them so
  // their stream sees getJob() come back empty and shuts down.
  if (previous) notify(previous)
  return job
}

function finish(job: Job, status: Exclude<JobStatus, 'running'>, error?: string): void {
  if (job.status !== 'running') return
  job.status = status
  job.error = error ?? null
  job.endedAt = Date.now()
  job.currentStep = 0
  notify(job)
  setTimeout(() => forget(job), keptFor(job)).unref?.()
}

/**
 * How long a run stays in memory after it ends. Past that no page may read it
 * (isWatchable), so its images and prompt are dropped instead of waiting for
 * the backend's next run to replace them.
 */
export function keptFor(job: Job): number {
  return job.secret ? SECRET_GRACE_MS : RESUME_WINDOW_MS
}

/** Drops a run from memory: its images, its prompt, and the record itself. */
export function forget(job: Job): void {
  if (jobs.get(job.backend) === job) jobs.delete(job.backend)
  job.images = []
  job.context = { ...job.context, request: { ...job.context.request, prompt: '', negative_prompt: '' } }
  // A stream still open on it sees it gone and closes.
  notify(job)
}

/**
 * Reads a run's events into its record until they end. Runs detached from the
 * request that started it — that is the point: the browser may come and go,
 * this keeps reading.
 */
export async function consumeEvents(job: Job, events: AsyncIterable<BackendEvent>, sink?: ImageSink): Promise<void> {
  try {
    for await (const event of events) {
      applyEvent(job, event, sink)
      if (job.status !== 'running') return
    }
    finish(job, 'done')
  } catch (error) {
    console.error(`[${job.backend}] job stream error:`, error)
    finish(job, 'error', 'Lost the connection to the backend mid-generation.')
  }
}

function save(job: Job, image: JobImage, index: number, sink: ImageSink): void {
  job.pendingSaves += 1
  sink(job, image, index)
    .then((name) => {
      image.saved_name = name
    })
    .catch((error: unknown) => {
      job.saveError = error instanceof Error ? error.message : String(error)
    })
    .finally(() => {
      job.pendingSaves -= 1
      notify(job)
    })
}

export function applyEvent(job: Job, event: BackendEvent, sink?: ImageSink): void {
  switch (event.type) {
    case 'start':
      job.currentStep = 0
      if (event.runId) job.runId = event.runId
      job.stepsPerImage = event.steps || job.stepsPerImage
      job.completed = event.index
      job.total = event.total || job.total
      notify(job)
      return
    case 'step':
      job.currentStep = event.step
      notify(job)
      return
    case 'image': {
      job.stepsPerImage = event.stepsObserved || job.stepsPerImage
      const image: JobImage = { seed: event.seed, image_base64: event.imageBase64, saved_name: null }
      const index = job.images.length
      job.images.push(image)
      // Per image rather than once at the end: one failure cannot take the
      // rest of the run's files with it.
      if (sink) save(job, image, index, sink)
      job.completed = event.index + 1
      job.total = event.total ?? job.total
      job.currentStep = 0
      notify(job)
      return
    }
    case 'done':
      finish(job, 'done')
      return
    case 'cancelled':
      finish(job, 'cancelled')
      return
    case 'error':
      finish(job, 'error', event.message)
      return
  }
}
