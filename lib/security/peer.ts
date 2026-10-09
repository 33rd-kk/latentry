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

import { installPeerStamp } from './peer-stamp.mjs'

export { installPeerStamp }

const globalForPeer = globalThis as typeof globalThis & { __latentryPeerHeader?: string }

/** Whether an address (or `localhost`) is this machine's loopback. */
export function isLoopbackAddress(value: string): boolean {
  const host = value.trim().toLowerCase().replace(/^\[|\]$/g, '')
  return host === 'localhost' || host === '::1' || /^(::ffff:)?127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
}

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
