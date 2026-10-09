// Stamps every request with the address it really came from; see peer.ts.
//
// Plain JavaScript so that scripts/peer-stamp-preload.mjs can load it into
// Node before Next.js starts: installed any later, the first request after a
// start arrives unstamped and is taken for another device.

import { randomBytes } from 'node:crypto'
import http from 'node:http'

/** Starts stamping requests; once per process, before the first request. */
export function installPeerStamp() {
  if (globalThis.__latentryPeerHeader) return
  const header = `x-latentry-peer-${randomBytes(8).toString('hex')}`
  const emit = http.Server.prototype.emit
  http.Server.prototype.emit = function (event, ...args) {
    if (event === 'request') {
      const request = args[0]
      request.headers[header] = request.socket?.remoteAddress ?? ''
    }
    return Reflect.apply(emit, this, [event, ...args])
  }
  globalThis.__latentryPeerHeader = header
}
