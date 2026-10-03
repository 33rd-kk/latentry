import { adapterFor, getBackends } from '@/lib/backends'
import { taggerPreference } from '@/lib/backends/config'
import { backendStatus, json } from '@/lib/api'
import { getSettings } from '@/lib/settings/store'

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
  // Profile defaults changed on the settings page ride along: the form needs
  // them at the same moment it learns which backend it is filling in.
  return json({ backends: statuses, tagger, profiles: getSettings().profiles ?? {} })
}
