import { A1111Adapter } from './a1111'
import { ComfyUIAdapter } from './comfyui'
import { getBackendConfig } from './config'
import { DiffusersAdapter } from './diffusers'
import type { BackendAdapter, BackendConfig } from './types'

export function adapterFor(config: BackendConfig): BackendAdapter {
  switch (config.kind) {
    case 'a1111':
      return new A1111Adapter(config)
    case 'comfyui':
      return new ComfyUIAdapter(config)
    case 'diffusers':
      return new DiffusersAdapter(config)
    default:
      // Kinds are checked where they are read; one that slipped through is a bug, not a diffusers server.
      throw new Error(`Unknown backend kind: ${String((config as { kind?: unknown }).kind)}`)
  }
}

/** The adapter for an id from a URL, or null for an id that is not configured. */
export function getAdapter(id: string): BackendAdapter | null {
  const config = getBackendConfig(id)
  return config ? adapterFor(config) : null
}

export { getBackends, usableBackends } from './config'
export type * from './types'
