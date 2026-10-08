// The address a request really came from, for the checks that must not be
// fooled by headers.
//
// A route handler only sees headers, and X-Forwarded-For is one a client can
// write: Next.js fills it from the socket only when it is missing. So when
// the server starts, every request is stamped with its socket's address
// under a header whose name is random for this process. A client cannot
// guess the name, and whatever it sends under it is replaced.

import { randomBytes } from 'node:crypto'
import http from 'node:http'
import type { IncomingMessage } from 'node:http'

const globalForPeer = globalThis as typeof globalThis & { __latentryPeerHeader?: string }

/** Starts stamping requests; once per process, before the first request. */
export function installPeerStamp(): void {
  if (globalForPeer.__latentryPeerHeader) return
  const header = `x-latentry-peer-${randomBytes(8).toString('hex')}`
  const emit = http.Server.prototype.emit
  http.Server.prototype.emit = function (this: http.Server, event: string | symbol, ...args: unknown[]) {
    if (event === 'request') {
      const request = args[0] as IncomingMessage
      request.headers[header] = request.socket?.remoteAddress ?? ''
    }
    return Reflect.apply(emit, this, [event, ...args]) as boolean
  } as typeof emit
  globalForPeer.__latentryPeerHeader = header
}

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
