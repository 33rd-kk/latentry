import { json } from '@/lib/api'
import { getSettings } from '@/lib/settings/store'
import { wildcardsAccess } from '@/lib/wildcards/access'
import { listWildcards } from '@/lib/wildcards/folder'

export const runtime = 'nodejs'

/**
 * The wildcards in the wildcards folder, for the picker on the generate page.
 * Names only, never paths or lines. They are the user's own files, so by
 * default only for a client that may change settings; with "Use on paired
 * devices" (settings.wildcards.share) for any client that got past pairing
 * too (see lib/wildcards/access.ts).
 *
 *   GET ?probe=1   { available, shared }         whether this client gets a picker; no names
 *   GET            { available, shared, names }  the list, asked for when the picker opens
 */
export async function GET(request: Request) {
  const settings = getSettings()
  const access = wildcardsAccess(request.headers, settings)
  const dir = settings.wildcards?.dir
  if (!access || !dir) return json({ available: false, shared: false })
  const flags = { available: true, shared: access === 'shared' }
  if (new URL(request.url).searchParams.get('probe') === '1') return json(flags)
  return json({ ...flags, names: await listWildcards(dir) })
}
