import { NextResponse } from 'next/server'
import { adapterOr404, jsonError, json, readJson } from '@/lib/api'
import { toPoseRequest } from '@/lib/pose'
import { tryEnter } from '@/lib/security/concurrency'

export const runtime = 'nodejs'

// A preview is asked for when a picture is dropped in; two at once covers a
// quick second drop, more is a flood.
const MAX_AT_ONCE = 2

/** The skeleton the backend would follow for a picture, for the pose preview. */
export async function POST(request: Request, ctx: RouteContext<'/api/gen/[backend]/pose'>) {
  const id = (await ctx.params).backend
  const adapter = adapterOr404(id)
  if (adapter instanceof NextResponse) return adapter
  if (!adapter.pose) return jsonError('Pose control is not available on this backend', 404)

  const release = tryEnter(`gen:pose:${id}`, MAX_AT_ONCE)
  if (!release) return jsonError('Busy reading other poses. Try again in a moment.', 409)
  try {
    const pose = toPoseRequest(await readJson(request))
    if (typeof pose === 'string') return jsonError(pose, 400)
    const result = await adapter.pose(pose)
    return result.ok ? json(result.value) : jsonError(result.error, result.status)
  } finally {
    release()
  }
}
