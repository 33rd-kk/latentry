// Guard for every /api route.
//
// Those routes attach server-side tokens, drive a local GPU and read and write
// image folders, and they have no login: whoever can reach them can use them.
// Two ways a browser gets there without its owner meaning it:
//
// - CSRF: any site its owner visits can POST to http://localhost:<port>.
//   request.json() ignores Content-Type, so a `text/plain` "simple request"
//   (no CORS preflight) would be parsed and acted on.
// - DNS rebinding: an attacker's hostname re-resolved to 127.0.0.1 makes their
//   page same-origin with this server, so it can also read the responses.
//
// Run from proxy.ts.

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export interface RouteRejection {
  status: 403 | 415
  error: string
}

/** Host header -> bare lowercase hostname (port and IPv6 brackets dropped). */
function hostnameOf(host: string): string {
  const h = host.trim().toLowerCase()
  if (h.startsWith('[')) return h.slice(1, h.indexOf(']'))
  const colon = h.lastIndexOf(':')
  return colon === -1 ? h : h.slice(0, colon)
}

/**
 * Loopback and private-network IP literals, plus `localhost`. IP literals and
 * localhost cannot be rebound, which is what makes them safe to trust here;
 * the private ranges keep a phone on the same LAN working.
 */
function isLocalHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '::1') return true
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
}

function extraAllowedHosts(env: Record<string, string | undefined>): string[] {
  return (env.ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
}

/** Returns why an /api request must be refused, or null to let it through. */
export function checkApiRequest(
  request: { method: string; headers: Headers },
  env: Record<string, string | undefined>
): RouteRejection | null {
  // 1. DNS rebinding: only hosts that cannot be rebound (or explicitly listed).
  const host = request.headers.get('host') ?? ''
  const hostname = hostnameOf(host)
  if (!isLocalHostname(hostname) && !extraAllowedHosts(env).includes(hostname)) {
    return { status: 403, error: 'Forbidden host (add it to ALLOWED_HOSTS to serve it)' }
  }

  // 2. CSRF: only our own pages. 'none' is the owner opening the URL directly.
  // Browsers without Sec-Fetch-Site still send Origin on POST.
  const site = request.headers.get('sec-fetch-site')
  if (site !== null) {
    if (site !== 'same-origin' && site !== 'none') {
      return { status: 403, error: 'Cross-site request refused' }
    }
  } else {
    const origin = request.headers.get('origin')
    if (origin !== null) {
      let originHost: string | null = null
      try {
        originHost = new URL(origin).host.toLowerCase()
      } catch {
        // "null" or garbage
      }
      if (originHost !== host.trim().toLowerCase()) {
        return { status: 403, error: 'Cross-site request refused' }
      }
    }
  }

  // 3. A body must be JSON, so a CORS "simple request" can never carry one.
  if (UNSAFE_METHODS.has(request.method.toUpperCase())) {
    const type = request.headers.get('content-type')
    if (type !== null && type.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return { status: 415, error: 'Content-Type must be application/json' }
    }
  }

  return null
}
