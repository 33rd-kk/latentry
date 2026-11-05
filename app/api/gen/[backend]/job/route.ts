import { adapterOr404, json } from '@/lib/api'
import { getCurrentJob, isResumable, toSnapshot } from '@/lib/diffusion/job-store'
import { waitingCount } from '@/lib/diffusion/run-queue'
import { maySeeRun, viewerOf } from '@/lib/security/viewer'

export const runtime = 'nodejs'

/**
 * What this backend is generating right now, for a page that has just loaded
 * and needs to know whether there is a run to reattach to. Without the images:
 * a finished 16-image batch is tens of megabytes, and the page only needs the
 * numbers to decide; the images come with the stream's snapshot.
 *
 * A paired device is told only about a run it started itself.
 *
 * `queued` is how many runs wait behind it — only the number: which runs and
 * what they draw is for the page that queued each one.
 */
export async function GET(request: Request, ctx: RouteContext<'/api/gen/[backend]/job'>) {
  const adapter = adapterOr404((await ctx.params).backend)
  if (adapter instanceof Response) return adapter
  const job = getCurrentJob(adapter.config.id)
  const shown = job && isResumable(job) && maySeeRun(viewerOf(request.headers), job.context.startedBy)
  return json({ job: shown ? toSnapshot(job) : null, queued: waitingCount(adapter.config.id) })
}
