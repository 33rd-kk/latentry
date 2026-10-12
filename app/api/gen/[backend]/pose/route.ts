import { adapterOr404, jsonError, json, readJson } from '@/lib/api'
import { WORKFLOW_NAME } from '@/lib/backends/types'
import { workflowAccess } from '@/lib/backends/workflow-access'
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
  if (adapter instanceof Response) return adapter
  if (!adapter.pose) return jsonError('Pose control is not available on this backend', 404)

  const release = tryEnter(`gen:pose:${id}`, MAX_AT_ONCE)
  if (!release) return jsonError('Busy reading other poses. Try again in a moment.', 409)
  try {
    const body = await readJson(request)
    const pose = toPoseRequest(body)
    if (typeof pose === 'string') return jsonError(pose, 400)
    // Drawn for a ComfyUI workflow: only for a client that may run it, as on generate.
    const workflow = typeof body?.workflow === 'string' && WORKFLOW_NAME.test(body.workflow) ? body.workflow : undefined
    if (workflow && !workflowAccess(request.headers, adapter.config)) return jsonError('Workflows are not available to this device', 403)
    const result = await adapter.pose(pose, workflow ? { workflow } : {})
    return result.ok ? json(result.value) : jsonError(result.error, result.status)
  } finally {
    release()
  }
}
