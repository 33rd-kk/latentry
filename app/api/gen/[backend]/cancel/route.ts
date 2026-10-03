import { NextResponse } from 'next/server'
import { adapterOr404, jsonError, json } from '@/lib/api'
import { getCurrentJob } from '@/lib/diffusion/job-store'

export const runtime = 'nodejs'

/**
 * Asks the backend to stop the run in flight. It stops at the next step
 * boundary, not instantly; the job stream reports the end when it happens.
 */
export async function POST(_request: Request, ctx: RouteContext<'/api/gen/[backend]/cancel'>) {
  const adapter = adapterOr404((await ctx.params).backend)
  if (adapter instanceof NextResponse) return adapter
  // Name the run, so a click that arrives just after it ended cannot stop the
  // run that replaced it.
  const runId = getCurrentJob(adapter.config.id)?.runId ?? null
  const result = await adapter.cancel(runId)
  return result.ok ? json(result.value) : jsonError(result.error, result.status)
}
