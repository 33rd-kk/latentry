import { adapterFor, getBackends } from '@/lib/backends'
import { backendStatus, json } from '@/lib/api'
import { getSettings } from '@/lib/settings/store'
import { taggerIdFrom } from '@/lib/tagger'

export const runtime = 'nodejs'

/**
 * Every configured backend and what it can do right now. The page polls this
 * for its status badges; no URL or token is in it, only the ids.
 */
export async function GET() {
  const statuses = await Promise.all(getBackends().map((config) => backendStatus(adapterFor(config))))
  const tagger = taggerIdFrom(statuses)
  // Profile defaults changed on the settings page ride along: the form needs
  // them at the same moment it learns which backend it is filling in.
  return json({ backends: statuses, tagger, profiles: getSettings().profiles ?? {} })
}
