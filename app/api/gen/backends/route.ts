import { adapterFor, usableBackends } from '@/lib/backends'
import { backendStatus, json } from '@/lib/api'
import { getSettings } from '@/lib/settings/store'
import { taggerIdFrom } from '@/lib/tagger'
import { poolOf } from '@/lib/diffusion/gpu-pool'

export const runtime = 'nodejs'

/**
 * Every configured backend and what it can do right now. The page polls this
 * for its status badges; no URL or token is in it, only the ids.
 */
export async function GET() {
  // Each with its pool, if any, so the page can offer Any free GPU among engines with the same model.
  const statuses = await Promise.all(
    usableBackends().map(async (config) => {
      const status = await backendStatus(adapterFor(config))
      const pool = poolOf(config)
      return pool ? { ...status, pool } : status
    })
  )
  const tagger = taggerIdFrom(statuses)
  // Profile defaults changed on the settings page ride along: the form needs
  // them at the same moment it learns which backend it is filling in.
  return json({ backends: statuses, tagger, profiles: getSettings().profiles ?? {} })
}
