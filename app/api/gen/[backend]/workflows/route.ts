import { NextResponse } from 'next/server'
import { adapterOr404, json } from '@/lib/api'
import { listWorkflows } from '@/lib/backends/comfy-workflows'
import { workflowAccess } from '@/lib/backends/workflow-access'

export const runtime = 'nodejs'

/**
 * The workflows a ComfyUI backend can run instead of its built-in graph: the
 * API-format JSON files in its folder, by name, with what each lacks for
 * Latentry to fill it (see lib/backends/comfy-workflows.ts).
 *
 * Only for a client that may see them (lib/backends/workflow-access.ts); for
 * anyone else, and for a backend without a folder, the list is empty. Never
 * the folder's path, and never a graph.
 */
export async function GET(request: Request, ctx: RouteContext<'/api/gen/[backend]/workflows'>) {
  const adapter = adapterOr404((await ctx.params).backend)
  if (adapter instanceof NextResponse) return adapter
  const dir = adapter.config.workflowsDir
  if (!dir || !workflowAccess(request.headers, adapter.config)) {
    return json({ workflows: [] })
  }
  return json({ workflows: await listWorkflows(dir) })
}
