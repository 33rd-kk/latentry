import { A1111Adapter } from './a1111'
import { getBackendConfig, getBackends, taggerPreference } from './config'
import { DiffusersAdapter } from './diffusers'
import type { BackendAdapter, BackendConfig } from './types'

export function adapterFor(config: BackendConfig): BackendAdapter {
  return config.kind === 'a1111' ? new A1111Adapter(config) : new DiffusersAdapter(config)
}

/** The adapter for an id from a URL, or null for an id that is not configured. */
export function getAdapter(id: string): BackendAdapter | null {
  const config = getBackendConfig(id)
  return config ? adapterFor(config) : null
}

/**
 * Where a picture goes to be tagged: TAGGER_BACKEND when it names a backend,
 * otherwise the first one whose status says it can tag.
 */
export async function getTaggerAdapter(): Promise<BackendAdapter | null> {
  const preferred = taggerPreference()
  if (preferred) {
    const adapter = getAdapter(preferred)
    if (adapter?.tag) return adapter
  }
  for (const config of getBackends()) {
    const adapter = adapterFor(config)
    if (!adapter.tag) continue
    const status = await adapter.status()
    if (status.alive && status.capabilities.tag) return adapter
  }
  return null
}

export { getBackends } from './config'
export type * from './types'
