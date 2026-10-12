// Whether an address is this machine's own. Kept apart from peer.ts, which
// loads Node's http and crypto, so the page can use it too.

/** Whether an address (or `localhost`) is this machine's loopback. */
export function isLoopbackAddress(value: string): boolean {
  const host = value.trim().toLowerCase().replace(/^\[|\]$/g, '')
  return host === 'localhost' || host === '::1' || /^(::ffff:)?127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
}
