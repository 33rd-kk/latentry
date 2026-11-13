import { adapterOr404, jsonError, json, readJson } from '@/lib/api'
import { getCurrentJob } from '@/lib/diffusion/job-store'
import { cancelGrid, cancelQueued, getGrid, poolQueued } from '@/lib/diffusion/run-queue'
import { poolJob } from '@/lib/diffusion/gpu-pool'
import { getAdapter } from '@/lib/backends'
import { cancelFaceFix } from '@/lib/facefix/run'
import { maySeeRun, viewerOf } from '@/lib/security/viewer'

export const runtime = 'nodejs'

/**
 * Asks the backend to stop the run in flight. It stops at the next step
 * boundary, not instantly; the job stream reports the end when it happens.
 * A run still waiting in the queue is taken out of it, prompt and pictures
 * with it. An X/Y grid's id stops the whole grid: its cell going now, and
 * the ones not started yet.
 *
 *   POST { job: string }   the job id the page is watching
 *
 * Only the run with that id is stopped: a client that cannot name the run
 * (another device that was never told it, or a secret run's id, which is
 * never handed out) cannot stop it, and a click that arrives just after a run
 * ended cannot stop the one that replaced it. A paired device stops only a
 * run it started.
 */
export async function POST(request: Request, ctx: RouteContext<'/api/gen/[backend]/cancel'>) {
  const adapter = adapterOr404((await ctx.params).backend)
  if (adapter instanceof Response) return adapter
  const body = await readJson(request)
  const viewer = viewerOf(request.headers)
  const found = typeof body?.job === 'string' ? getGrid(adapter.config.id, body.job) : null
  const grid = found && maySeeRun(viewer, found.startedBy) ? found : null
  if (grid) {
    await cancelGrid(grid)
    return json({ status: 'cancelled' })
  }
  // A run asked for here may wait on, or be drawn by, another engine of its pool (Any free GPU).
  const waiting = !found && typeof body?.job === 'string' ? poolQueued(adapter.config.id, body.job) : null
  const queued = waiting && maySeeRun(viewer, waiting.startedBy) ? waiting : null
  if (queued) {
    cancelQueued(queued)
    return json({ status: 'cancelled' })
  }
  const located = !found && !waiting && typeof body?.job === 'string' ? poolJob(adapter.config.id, body.job) : null
  const drawing = located ? located.backend : adapter.config.id
  const current = getCurrentJob(drawing)
  const drawer = drawing === adapter.config.id ? adapter : getAdapter(drawing)
  if (found || waiting || !drawer || typeof body?.job !== 'string' || !current || current.id !== body.job || current.status !== 'running' || !maySeeRun(viewer, current.context.startedBy)) {
    return jsonError('That run is not running', 409)
  }
  // A face fix stops the face being drawn and skips the rest.
  const result = (await cancelFaceFix(drawing)) ?? (await drawer.cancel(current.runId))
  return result.ok ? json(result.value) : jsonError(result.error, result.status)
}
