// Response headers proxy.ts adds to everything it lets through.
//
// Latentry needs no camera, microphone or location, is never framed, and its
// pages show prompts and pictures that should not linger in the browser's
// cache once the tab is closed. The CSP is the part that cannot break the
// app: no plugins, no <base> rewriting, no frames, forms only to itself.
// Scripts are left to Next.js, whose inline bootstrap a script-src would have
// to allow anyway.

const PERMISSIONS_POLICY = ['camera', 'microphone', 'geolocation', 'payment', 'usb', 'serial', 'bluetooth', 'hid']
  .map((feature) => `${feature}=()`)
  .join(', ')

const CONTENT_SECURITY_POLICY = "frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'"

/** The headers for a response to `pathname`; /api routes set their own Cache-Control. */
export function securityHeaders(pathname: string): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': PERMISSIONS_POLICY,
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  }
  if (!pathname.startsWith('/api/')) {
    headers['X-Frame-Options'] = 'DENY'
    headers['Cache-Control'] = 'no-store'
  }
  return headers
}
