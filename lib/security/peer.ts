// The address a request really came from, for the checks that must not be
// fooled by headers.
//
// A route handler only sees headers, and X-Forwarded-For is one a client can
// write: Next.js fills it from the socket only when it is missing. So when
// the server starts, every request is stamped with its socket's address
// under a header whose name is random for this process. A client cannot
// guess the name, and whatever it sends under it is replaced.
//
// The stamping itself is in peer-stamp.mjs. serve.mjs loads it before Next.js
// starts; instrumentation.ts installs it too, for a server started otherwise.

import { isLoopbackAddress } from './loopback'
import { installPeerStamp } from './peer-stamp.mjs'

export { installPeerStamp, isLoopbackAddress }

const globalForPeer = globalThis as typeof globalThis & { __latentryPeerHeader?: string }

/** The stamp's header name for this process, once stamping is on. */
export function peerHeaderName(): string | undefined {
  return globalForPeer.__latentryPeerHeader
}

/**
 * The socket address of this request; '' when stamping is on but the request
 * carries no stamp, undefined when stamping is not running (the verify
 * scripts, which call route code directly).
 */
export function peerAddress(headers: Headers): string | undefined {
  const header = globalForPeer.__latentryPeerHeader
  if (!header) return undefined
  return headers.get(header) ?? ''
}
