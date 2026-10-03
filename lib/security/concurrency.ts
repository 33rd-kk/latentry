// In-process concurrency controls for the routes that drive a backend.
//
// A backend does one heavy thing at a time on one GPU. The routes already hand
// back a run that is going instead of starting a second one, but that check is
// not enough on its own: between "nothing is running" and the run being
// recorded there is an `await fetch` of up to 30 seconds, and two requests that
// arrive inside it both get through. A lock taken synchronously, before the
// first await, closes that.
//
// Everything is held on globalThis so `next dev`'s hot reload -- which
// re-evaluates this module -- cannot drop a lock or forget a running run, the
// same way lib/diffusion/job-store.ts keeps its jobs.
//
// Single process only, which is what a self-hosted `next dev` / `next start` is.

export type Release = () => void

interface ActiveRun {
  id: string
  isActive: () => boolean
}

interface ConcurrencyState {
  locks: Set<string>
  counts: Map<string, number>
  runs: Map<string, ActiveRun>
}

const globalForConcurrency = globalThis as typeof globalThis & {
  __devConcurrency?: ConcurrencyState
}

const state = (globalForConcurrency.__devConcurrency ??= {
  locks: new Set(),
  counts: new Map(),
  runs: new Map(),
})

/** A release that can be called from every exit path without double-counting. */
function once(fn: () => void): Release {
  let released = false
  return () => {
    if (released) return
    released = true
    fn()
  }
}

/**
 * Takes the lock named `key`, or answers null if someone already holds it.
 * Synchronous on purpose: take it before the first await.
 */
export function tryAcquire(key: string): Release | null {
  if (state.locks.has(key)) return null
  state.locks.add(key)
  return once(() => {
    state.locks.delete(key)
  })
}

/**
 * Lets at most `max` holders of `key` in at once; the one after that gets null
 * rather than a place in a queue. For a slot held as long as a request or a
 * connection is open.
 */
export function tryEnter(key: string, max: number): Release | null {
  const current = state.counts.get(key) ?? 0
  if (current >= max) return null
  state.counts.set(key, current + 1)
  return once(() => {
    const remaining = (state.counts.get(key) ?? 1) - 1
    if (remaining <= 0) state.counts.delete(key)
    else state.counts.set(key, remaining)
  })
}

/** How many holders `key` has right now. For tests and diagnostics. */
export function holders(key: string): number {
  return state.counts.get(key) ?? 0
}

/**
 * Records the run now occupying `key`. `isActive` is asked each time, so the
 * run frees the slot by finishing -- nobody has to remember to clear it.
 */
export function setActiveRun(key: string, id: string, isActive: () => boolean): void {
  state.runs.set(key, { id, isActive })
}

/** The id of the run occupying `key`, or null once it has finished. */
export function activeRun(key: string): string | null {
  const run = state.runs.get(key)
  if (!run) return null
  if (run.isActive()) return run.id
  state.runs.delete(key)
  return null
}
