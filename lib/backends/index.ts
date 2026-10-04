import { A1111Adapter } from './a1111'
import { getBackendConfig } from './config'
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

export { getBackends, usableBackends } from './config'
export type * from './types'
