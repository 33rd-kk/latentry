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
// browser cannot forge. A program on the LAN can (Next.js does not expose the
// socket address to a route), so on a network with people you do not trust,
// use "off" and edit latentry.settings.json by hand.

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

/** Why this request may not change settings, or null when it may. */
export function editRefusal(headers: Headers, env: Env = process.env): 'off' | 'notLocal' | null {
  const mode = editMode(env)
  if (mode === 'off') return 'off'
  if (mode === 'lan') return null
  const host = hostnameOf(headers.get('host') ?? '')
  return isLoopback(host) && isLoopback(clientIp(headers)) ? null : 'notLocal'
}
