import { NextResponse } from 'next/server'
import { adapterOr404, jsonError, json, readJson } from '@/lib/api'
import { getCurrentJob } from '@/lib/diffusion/job-store'

export const runtime = 'nodejs'

/**
 * Asks the backend to stop the run in flight. It stops at the next step
 * boundary, not instantly; the job stream reports the end when it happens.
 *
 *   POST { job: string }   the job id the page is watching
 *
 * Only the run with that id is stopped: a client that cannot name the run
 * (another device that was never told it, or a secret run's id, which is
 * never handed out) cannot stop it, and a click that arrives just after a run
 * ended cannot stop the one that replaced it.
 */
export async function POST(request: Request, ctx: RouteContext<'/api/gen/[backend]/cancel'>) {
  const adapter = adapterOr404((await ctx.params).backend)
  if (adapter instanceof NextResponse) return adapter
  const body = await readJson(request)
  const current = getCurrentJob(adapter.config.id)
  if (typeof body?.job !== 'string' || !current || current.id !== body.job || current.status !== 'running') {
    return jsonError('That run is not running', 409)
  }
  const result = await adapter.cancel(current.runId)
  return result.ok ? json(result.value) : jsonError(result.error, result.status)
}
