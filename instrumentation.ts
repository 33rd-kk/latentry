// Runs once when the server starts: stops trusting certificate authorities
// whose keys are known to be compromised (see lib/security/distrusted-roots.ts),
// stamps each request with the address it
// really came from (see lib/security/peer.ts), makes the private files
// owner-only (see lib/security/private-files.ts), writes the token a terminal
// in the container proves itself with (see lib/security/local-token.ts; only
// with LATENTRY_TRUST_LOOPBACK=off), then brings up Latentry's
// own engine if it is installed (see lib/engine). LATENTRY_ENGINE=off, or
// turning auto-start off on the setup page, leaves it to be started by hand.

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  // First, before anything downloads.
  const { dropDistrustedRoots } = await import('./lib/security/distrusted-roots')
  const dropped = dropDistrustedRoots()
  if (dropped.length) console.log(`[security] no longer trusting ${dropped.join(', ')} (compromised; this Node.js still lists them)`)
  const { installPeerStamp } = await import('./lib/security/peer')
  installPeerStamp()
  const { restrictPrivateFiles } = await import('./lib/security/private-files')
  restrictPrivateFiles()
  const { writeLocalToken } = await import('./lib/security/local-token')
  writeLocalToken()
  const { autoStart } = await import('./lib/engine/supervisor')
  await autoStart()
}
