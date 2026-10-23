// Certificate authorities the server stops trusting, whatever Node.js it runs on.
//
// Latentry's own downloads (models from Hugging Face, uv from GitHub) go
// through Node.js's TLS, which trusts the roots built into that Node.js
// release. Eight intermediate certificates under emSign ECC Root CA - G3
// have compromised private keys (GHSA-6q48-6c7w-9gw2), so whoever holds one
// can issue a certificate for any host. NSS 3.131.1 removed that root and two
// more of its family, and Node.js followed in 22.23.4, 24.22.1 and 26.12.1.
// An older Node.js still trusts them; this drops them at start-up, so the
// server behaves as a fixed Node.js would. None of the hosts Latentry
// downloads from chains to them.

import { X509Certificate } from 'node:crypto'
import tls from 'node:tls'

/** SHA-256 fingerprints, as NSS's certdata.txt lists them before NSS 3.131.1 removed them. */
export const DISTRUSTED_ROOTS: Record<string, string> = {
  '86:A1:EC:BA:08:9C:4A:8D:3B:BE:27:34:C6:12:BA:34:1D:81:3E:04:3C:F9:E8:A8:62:CD:5C:57:A3:6B:BE:6B': 'emSign ECC Root CA - G3',
  '12:56:09:AA:30:1D:A0:A2:49:B9:7A:82:39:CB:6A:34:21:6F:44:DC:AC:9F:39:54:B1:42:92:F2:E8:C8:60:8F': 'emSign Root CA - C1',
  'BC:4D:80:9B:15:18:9D:78:DB:3E:1D:8C:F4:F9:72:6A:79:5D:A1:64:3C:A5:F1:35:8E:1D:DB:0E:DC:0D:7E:B3': 'emSign ECC Root CA - C3',
}

/** Whether a PEM certificate is one of DISTRUSTED_ROOTS. One that cannot be read is kept, as Node.js would keep it. */
export function isDistrusted(pem: string): boolean {
  try {
    return new X509Certificate(pem).fingerprint256 in DISTRUSTED_ROOTS
  } catch {
    return false
  }
}

/**
 * Takes DISTRUSTED_ROOTS out of the certificates every TLS client in this
 * process trusts by default (fetch included). Everything else stays as it
 * was, NODE_EXTRA_CA_CERTS and --use-system-ca included. Returns the names
 * of the roots it took out: none on a Node.js that has dropped them itself.
 */
export function dropDistrustedRoots(): string[] {
  const current = tls.getCACertificates('default')
  const kept = current.filter((pem) => !isDistrusted(pem))
  if (kept.length === current.length) return []
  tls.setDefaultCACertificates(kept)
  return current.filter(isDistrusted).map((pem) => DISTRUSTED_ROOTS[new X509Certificate(pem).fingerprint256])
}
