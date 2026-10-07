// Who may change the settings.
//
// Settings decide which folders the gallery reads and where images are
// written, and they hold backend tokens. So changing them is narrower than
// using the app:
//
//   SETTINGS_EDIT=local   (default) only from this machine: localhost / loopback
//   SETTINGS_EDIT=lan     from any address /api answers (see route-guard.ts)
//   SETTINGS_EDIT=off     never; the page is read-only and .env.local rules
//
// "local" goes by the Host header and the forwarded client address, which a
// browser cannot forge, and by the address the connection really came from
// (lib/security/peer.ts), which nothing on the network can. The last is what
// stops a program on the LAN that writes the headers; a reverse proxy on this
// machine is still told apart by the client address it forwards.

import { peerAddress } from '@/lib/security/peer'
import { clientIp } from '@/lib/security/request-budget'

type Env = Record<string, string | undefined>

export type EditMode = 'local' | 'lan' | 'off'

export function editMode(env: Env = process.env): EditMode {
  const value = env.SETTINGS_EDIT?.trim().toLowerCase()
  return value === 'lan' || value === 'off' ? value : 'local'
}

function isLoopback(value: string): boolean {
  const host = value.trim().toLowerCase().replace(/^\[|\]$/g, '')
  return host === 'localhost' || host === '::1' || host === '::ffff:127.0.0.1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
}

function hostnameOf(host: string): string {
  const h = host.trim().toLowerCase()
  if (h.startsWith('[')) return h.slice(1, h.indexOf(']'))
  const colon = h.lastIndexOf(':')
  return colon === -1 ? h : h.slice(0, colon)
}

/**
 * Whether the request comes from this machine: the Host it asked for, the
 * client address it was forwarded for, and the address the connection
 * really came from are all loopback. Also used for what only makes sense on
 * this machine, like opening a picture in its file manager.
 */
export function isFromThisMachine(headers: Headers): boolean {
  const host = hostnameOf(headers.get('host') ?? '')
  const peer = peerAddress(headers)
  return isLoopback(host) && isLoopback(clientIp(headers)) && (peer === undefined || isLoopback(peer))
}

/** Why this request may not change settings, or null when it may. */
export function editRefusal(headers: Headers, env: Env = process.env): 'off' | 'notLocal' | null {
  const mode = editMode(env)
  if (mode === 'off') return 'off'
  if (mode === 'lan') return null
  return isFromThisMachine(headers) ? null : 'notLocal'
}
