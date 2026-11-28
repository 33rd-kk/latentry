import { adapterOr404, json } from '@/lib/api'
import { cloudRefusal } from '@/lib/backends/comfy-cloud-nodes'
import { listWorkflows } from '@/lib/backends/comfy-workflows'
import { ComfyUIAdapter } from '@/lib/backends/comfyui'
import { workflowAccess } from '@/lib/backends/workflow-access'

export const runtime = 'nodejs'

/**
 * The workflows a ComfyUI backend can run instead of its built-in graph: the
 * API-format JSON files in its folder, by name, with what each lacks for
 * Latentry to fill it (see lib/backends/comfy-workflows.ts). One with
 * ComfyUI's partner nodes is listed as one that cannot run, when ComfyUI
 * answers; when it does not, the run itself still refuses it
 * (lib/backends/comfy-cloud-nodes.ts).
 *
 * Only for a client that may see them (lib/backends/workflow-access.ts); for
 * anyone else, and for a backend without a folder, the list is empty. Never
 * the folder's path, and never a graph.
 */
export async function GET(request: Request, ctx: RouteContext<'/api/gen/[backend]/workflows'>) {
  const adapter = adapterOr404((await ctx.params).backend)
  if (adapter instanceof Response) return adapter
  const dir = adapter.config.workflowsDir
  if (!dir || !workflowAccess(request.headers, adapter.config)) {
    return json({ workflows: [] })
  }
  // Once ComfyUI does not answer, the rest are not asked about: the list is not held up for each.
  let answering = true
  const check =
    adapter instanceof ComfyUIAdapter
      ? async (graph: Record<string, unknown>) => {
          if (!answering) return undefined
          const checked = await adapter.cloudCheck(graph)
          // Only a sure answer is shown here; "could not ask" is left to the run.
          if ('cloud' in checked) return cloudRefusal(checked)?.error
          answering = false
          return undefined
        }
      : undefined
  return json({ workflows: await listWorkflows(dir, check) })
}
