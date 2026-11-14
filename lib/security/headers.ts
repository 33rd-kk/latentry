// Response headers proxy.ts adds to everything it answers.
//
// Latentry needs no camera, microphone or location, is never framed, and its
// pages show prompts and pictures that should not linger in the browser's
// cache once the tab is closed.
//
// The CSP lets a page run only the scripts Next.js rendered for that one
// response: proxy.ts makes a fresh nonce per page request and Next stamps it on
// its own scripts (node_modules/next/dist/docs/01-app/02-guides/
// content-security-policy.md). 'strict-dynamic' lets those load the chunks
// they need. Nothing else runs, so a prompt that slipped into a page as markup
// still could not run a script. Everything a page fetches, shows or loads comes
// from Latentry itself; pictures may also be data: and blob: URLs (previews,
// masks, poses).
//
// Styles keep 'unsafe-inline': sonner adds a <style> without a nonce, and
// style attributes are rendered on the server. A style cannot run a script.
//
// No upgrade-insecure-requests: Latentry is often used over plain http on the
// LAN, and that directive would send every request of such a page to https.
//
// API answers are JSON, pictures or files, never a page, so they may load and
// run nothing at all.

const PERMISSIONS_POLICY = ['camera', 'microphone', 'geolocation', 'payment', 'usb', 'serial', 'bluetooth', 'hid']
  .map((feature) => `${feature}=()`)
  .join(', ')

const ALWAYS = ["object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"]

/** The CSP for a page whose scripts carry `nonce`; dev adds 'unsafe-eval', which React's dev build needs. */
export function pagePolicy(nonce: string, dev = process.env.NODE_ENV === 'development'): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    ...ALWAYS,
  ].join('; ')
}

/** The CSP for an API answer: it loads and runs nothing. */
export const API_POLICY = ["default-src 'none'", ...ALWAYS].join('; ')

/** The CSP for a page proxy.ts writes itself (the 429 page): inline styles, no script. */
export const PLAIN_PAGE_POLICY = ["default-src 'none'", "style-src 'unsafe-inline'", ...ALWAYS].join('; ')

/** The request header proxy.ts passes a page's nonce to the server render in. */
export const NONCE_HEADER = 'x-nonce'

/** A fresh nonce for one page response: 16 random bytes in base64. */
export function newNonce(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64')
}

/**
 * The headers for a response to `pathname`; /api routes set their own
 * Cache-Control. A page Next renders gets `pagePolicy(nonce)`; a page without
 * a nonce (one proxy.ts answers itself) gets the script-free policy.
 */
export function securityHeaders(pathname: string, nonce?: string): Record<string, string> {
  const page = !pathname.startsWith('/api/')
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': PERMISSIONS_POLICY,
    'Content-Security-Policy': page ? (nonce ? pagePolicy(nonce) : PLAIN_PAGE_POLICY) : API_POLICY,
  }
  if (page) {
    headers['X-Frame-Options'] = 'DENY'
    headers['Cache-Control'] = 'no-store'
  }
  return headers
}
