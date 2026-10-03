import { NextResponse } from 'next/server'
import { adapterOr404, jsonError, json, readJson } from '@/lib/api'

export const runtime = 'nodejs'

/** The skeleton the backend would follow for a picture, for the pose preview. */
export async function POST(request: Request, ctx: RouteContext<'/api/gen/[backend]/pose'>) {
  const adapter = adapterOr404((await ctx.params).backend)
  if (adapter instanceof NextResponse) return adapter
  if (!adapter.pose) return jsonError('Pose control is not available on this backend', 404)

  const body = await readJson(request)
  if (typeof body?.image_base64 !== 'string' || !body.image_base64) return jsonError('image_base64 is required', 400)
  const result = await adapter.pose({
    image_base64: body.image_base64,
    ...(typeof body.width === 'number' ? { width: body.width } : {}),
    ...(typeof body.height === 'number' ? { height: body.height } : {}),
    // Whose pose in a picture of several people: an index into the previous
    // answer's `people`, or -1 for everyone. Absent means the most confident.
    ...(Number.isInteger(body.person) && (body.person as number) >= -1 ? { person: body.person as number } : {}),
  })
  return result.ok ? json(result.value) : jsonError(result.error, result.status)
}
