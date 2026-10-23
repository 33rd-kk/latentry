import { adapterOr404, jsonError, json, readJson } from '@/lib/api'
import { getCurrentJob, isWatchable, markSecret } from '@/lib/diffusion/job-store'
import { getGrid, getQueued, markQueuedSecret } from '@/lib/diffusion/run-queue'

export const runtime = 'nodejs'

/**
 * Secret mode was turned on while this run is on screen: make the run secret
 * from now on (see markSecret), and have the backend take back what it keeps
 * of it (ComfyUI's history and uploads).
 *
 *   POST { job: string }   the job id the page is watching
 *
 * Like cancel, only a client that can name the run may ask. It only ever
 * makes a run more private, and there is no way back.
 */
export async function POST(request: Request, ctx: RouteContext<'/api/gen/[backend]/job/secret'>) {
  const adapter = adapterOr404((await ctx.params).backend)
  if (adapter instanceof Response) return adapter
  const body = await readJson(request)
  // An X/Y grid: the cells to come start secret, and the ones that ran become so.
  const grid = typeof body?.job === 'string' ? getGrid(adapter.config.id, body.job) : null
  if (grid) {
    const ran = grid.grid?.jobs.some((job) => job !== null) === true
    markQueuedSecret(grid)
    if (ran) await adapter.markSecret?.()
    return json({ secret: true })
  }
  // Still waiting: it will start as a secret run, and has left nothing on the backend yet.
  const queued = typeof body?.job === 'string' ? getQueued(adapter.config.id, body.job) : null
  if (queued) {
    markQueuedSecret(queued)
    return json({ secret: true })
  }
  const current = getCurrentJob(adapter.config.id)
  if (typeof body?.job !== 'string' || !current || current.id !== body.job || !isWatchable(current)) {
    return jsonError('That run is not on this backend', 409)
  }
  markSecret(current)
  await adapter.markSecret?.()
  return json({ secret: true })
}
