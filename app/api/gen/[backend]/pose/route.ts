import { NextResponse } from 'next/server'
import { adapterOr404, jsonError, json, readJson } from '@/lib/api'
import { toPoseRequest } from '@/lib/pose'

export const runtime = 'nodejs'

/** The skeleton the backend would follow for a picture, for the pose preview. */
export async function POST(request: Request, ctx: RouteContext<'/api/gen/[backend]/pose'>) {
  const adapter = adapterOr404((await ctx.params).backend)
  if (adapter instanceof NextResponse) return adapter
  if (!adapter.pose) return jsonError('Pose control is not available on this backend', 404)

  const pose = toPoseRequest(await readJson(request))
  if (typeof pose === 'string') return jsonError(pose, 400)
  const result = await adapter.pose(pose)
  return result.ok ? json(result.value) : jsonError(result.error, result.status)
}
