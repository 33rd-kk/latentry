import { json } from '@/lib/api'
import { engineStatus } from '@/lib/engine/status'
import { editRefusal } from '@/lib/settings/access'

export const runtime = 'nodejs'

/**
 * The engine, its install and its models, for the setup page. Like the
 * settings, only for a client that may change them: the rest of the network
 * is not shown paths, ports or logs.
 */
export async function GET(request: Request) {
  const refusal = editRefusal(request.headers)
  if (refusal) return json({ editable: false, reason: refusal })
  return json(await engineStatus())
}
