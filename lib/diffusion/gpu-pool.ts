// Any free GPU: Latentry's own engines, one per GPU, form a pool. A run asked
// for with `any_gpu` on one of them may be drawn by another that is free and
// has the same model loaded: at once when the chosen engine is busy, or later,
// when another engine frees up before the chosen one (run-queue.ts adopts it).
//
// The page keeps watching the engine it chose: that engine's job, stream,
// cancel and secret routes find a run that went to another engine of its pool
// through `poolJob` / `poolQueued`, so nothing on the page has to follow it.
// A run only ever moves to an engine with the same model loaded; nothing here
// loads a model.

import { getAdapter, usableBackends } from '@/lib/backends'
import type { BackendConfig } from '@/lib/backends/types'
import { getCurrentJob, getJob, type Job } from './job-store'

const globalForPool = globalThis as typeof globalThis & {
  /** For tests: backend id → pool, in place of the engines' own. */
  __latentryTestPools?: Record<string, string>
}

/** For tests only: makes these backends a pool, as Latentry's engines are. */
export function setTestPools(pools: Record<string, string> | undefined): void {
  globalForPool.__latentryTestPools = pools
}

/** The pool a backend is in, if any (Latentry's engines: 'engine'). */
export function poolOf(config: BackendConfig): string | undefined {
  return globalForPool.__latentryTestPools?.[config.id] ?? config.pool
}

/** The other backends in `backend`'s pool, in the order they are listed; none for a backend in no pool. */
export function poolMembers(backend: string, configs: BackendConfig[] = usableBackends()): string[] {
  const own = configs.find((config) => config.id === backend)
  const pool = own ? poolOf(own) : undefined
  if (!pool) return []
  return configs.filter((config) => config.id !== backend && poolOf(config) === pool).map((config) => config.id)
}

/** The model a backend has loaded, or null when it is down or says none. */
export async function loadedModel(backend: string): Promise<string | null> {
  const adapter = getAdapter(backend)
  if (!adapter) return null
  const status = await adapter.status().catch(() => null)
  return status?.alive ? status.model : null
}

/** Whether `backend` can take a run now: up, not busy, nothing of ours going on it. */
export async function isFree(backend: string, queueLength: (backend: string) => number): Promise<boolean> {
  if (getCurrentJob(backend)?.status === 'running' || queueLength(backend) > 0) return false
  const status = await getAdapter(backend)?.status().catch(() => null)
  return Boolean(status?.alive && !status.busy)
}

/**
 * Another engine of `backend`'s pool that is free and has `model` loaded, for
 * a run that would otherwise wait for `backend`. Null when there is none.
 */
export async function freeMember(backend: string, model: string | null, queueLength: (backend: string) => number): Promise<string | null> {
  if (!model) return null
  for (const member of poolMembers(backend)) {
    if ((await loadedModel(member)) !== model) continue
    if (await isFree(member, queueLength)) return member
  }
  return null
}

/** Run `id` asked for on `backend`: its own, or one that went to another engine of its pool. */
export function poolJob(backend: string, id: string): { backend: string; job: Job } | null {
  const own = getJob(backend, id)
  if (own) return { backend, job: own }
  for (const member of poolMembers(backend)) {
    const job = getJob(member, id)
    if (job) return { backend: member, job }
  }
  return null
}
