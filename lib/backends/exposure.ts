// Whether a backend is likely open to the network with nothing in front of
// it. ComfyUI has no login, and an A1111 web UI has one only with
// --api-auth: reached at another address than this machine's loopback, the
// server listens on the network, and whoever reaches it can use it (ComfyUI's
// custom nodes run code). Latentry cannot protect that server; Settings says so.

import { isLoopbackAddress } from '@/lib/security/loopback'
import type { BackendKind } from './types'

export type OpenBackendWarning = 'comfyui' | 'a1111'

/** The warning for a backend reached over the network without a token, if any. */
export function openBackendWarning(backend: { kind: BackendKind; url: string; hasToken: boolean }): OpenBackendWarning | null {
  if (backend.kind !== 'comfyui' && backend.kind !== 'a1111') return null
  if (backend.hasToken) return null
  let host: string
  try {
    host = new URL(backend.url.trim()).hostname
  } catch {
    return null
  }
  if (!host || isLoopbackAddress(host)) return null
  return backend.kind
}
