import { jsonError, json, readJson } from '@/lib/api'
import { adapterFor } from '@/lib/backends'
import { getBackendConfig } from '@/lib/backends/config'
import { BACKEND_KINDS, type BackendKind } from '@/lib/backends/types'
import { isProfileId } from '@/lib/profiles'
import { editRefusal } from '@/lib/settings/access'
import { normalizeUrl, sameOrigin } from '@/lib/settings/schema'

export const runtime = 'nodejs'

/**
 * Tries a backend before it is saved: { kind, url, token?, id? }. Without a
 * token, the one already configured for `id` is used, but only when `url` is
 * still that backend's server: naming an id must not send its token anywhere
 * else. Limited to clients that may change settings, since it makes this
 * server call an arbitrary URL.
 */
export async function POST(request: Request) {
  if (editRefusal(request.headers)) return jsonError('Not allowed', 403)
  const body = await readJson(request)
  const kind = body?.kind
  const url = normalizeUrl(body?.url)
  if (typeof kind !== 'string' || !(BACKEND_KINDS as readonly string[]).includes(kind) || !url) {
    return jsonError('kind and an http(s) url are required', 400)
  }
  const id = typeof body?.id === 'string' ? body.id : ''
  const saved = getBackendConfig(id)
  const token = typeof body?.token === 'string' && body.token ? body.token : saved && sameOrigin(saved.url, url) ? saved.token : undefined
  const adapter = adapterFor({
    id: `test-${Date.now()}`,
    kind: kind as BackendKind,
    url,
    profile: isProfileId(body?.profile) ? body.profile : 'generic',
    ...(token ? { token } : {}),
  })
  const status = await adapter.status()
  return json({ alive: status.alive, model: status.model, capabilities: status.capabilities })
}
