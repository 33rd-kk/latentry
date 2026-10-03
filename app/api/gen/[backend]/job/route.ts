import { NextResponse } from 'next/server'
import { adapterOr404, json } from '@/lib/api'
import { getCurrentJob, isResumable, toSnapshot } from '@/lib/diffusion/job-store'

export const runtime = 'nodejs'

/**
 * What this backend is generating right now, for a page that has just loaded
 * and needs to know whether there is a run to reattach to. Without the images:
 * a finished 16-image batch is tens of megabytes, and the page only needs the
 * numbers to decide; the images come with the stream's snapshot.
 */
export async function GET(_request: Request, ctx: RouteContext<'/api/gen/[backend]/job'>) {
  const adapter = adapterOr404((await ctx.params).backend)
  if (adapter instanceof NextResponse) return adapter
  const job = getCurrentJob(adapter.config.id)
  return json({ job: job && isResumable(job) ? toSnapshot(job) : null })
}
