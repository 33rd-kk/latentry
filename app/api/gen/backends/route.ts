import { getBackends } from '@/lib/backends'
import { adapterFor } from '@/lib/backends'
import { taggerPreference } from '@/lib/backends/config'
import { backendStatus, json } from '@/lib/api'

export const runtime = 'nodejs'

/**
 * Every configured backend and what it can do right now. The page polls this
 * for its status badges; no URL or token is in it, only the ids.
 */
export async function GET() {
  const statuses = await Promise.all(getBackends().map((config) => backendStatus(adapterFor(config))))
  const preferred = taggerPreference()
  const tagger =
    statuses.find((status) => status.id === preferred && status.capabilities.tag)?.id ??
    statuses.find((status) => status.alive && status.capabilities.tag)?.id ??
    null
  return json({ backends: statuses, tagger })
}
