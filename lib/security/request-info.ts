// How a request reached Latentry, for what the pages say about it: whether it
// came over https, and whether devices reach this server over plain http on
// the network, where the pairing cookie and every page can be read on the way.
//
// These decide notices and the cookie's Secure flag, never who may do what: a
// forged header can only make a cookie stricter or show a warning.

import { isLoopbackAddress } from './loopback'
import { inContainer } from './local-token'

type Env = Record<string, string | undefined>

/**
 * Whether the page came over https, here or at a proxy in front (the first
 * X-Forwarded-Proto). Then the device cookie is marked Secure.
 */
export function isHttps(request: Request): boolean {
  if (new URL(request.url).protocol === 'https:') return true
  return request.headers.get('x-forwarded-proto')?.split(',')[0].trim().toLowerCase() === 'https'
}

/** Whether other devices can reach this server: it listens beyond loopback (set by scripts/serve.mjs). */
export function listensOnNetwork(env: Env = process.env): boolean {
  const host = env.LATENTRY_LISTEN_HOST?.trim()
  return !!host && !isLoopbackAddress(host)
}

/** The host name the browser asked for, without the port. */
function hostnameOf(host: string): string {
  const h = host.trim().toLowerCase()
  if (h.startsWith('[')) return h.slice(1, h.indexOf(']'))
  const colon = h.lastIndexOf(':')
  return colon === -1 ? h : h.slice(0, colon)
}

/**
 * Whether devices reach Latentry over plain http on the network:
 * - this request did, over http to an address that is not this computer's
 *   own (a phone on http://192.168.1.20:3000, or a proxy that serves http); or
 * - Latentry itself listens on the network (LATENTRY_HOST) over http, so any
 *   device that opens it does. Not counted in a container, whose image always
 *   listens on every address there; what reaches it is the port mapping's
 *   choice, and the first case still catches a device on plain http.
 * A request that came over https is never plain, wherever it came from.
 */
export function plainHttpOnNetwork(request: Request, env: Env = process.env, container: boolean = inContainer()): boolean {
  if (isHttps(request)) return false
  if (!isLoopbackAddress(hostnameOf(request.headers.get('host') ?? new URL(request.url).host))) return true
  return listensOnNetwork(env) && !container
}
