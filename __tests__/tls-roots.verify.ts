// The certificate authorities with compromised keys (lib/security/
// distrusted-roots.ts) are taken out of what the server's TLS trusts, and
// nothing else is: on a Node.js that still lists them, and on one that has
// dropped them itself.
//
// Run with: npm test -- tls-roots

import { X509Certificate } from 'node:crypto'
import tls from 'node:tls'
import { check, done, eq } from './assert'
import { DISTRUSTED_ROOTS, dropDistrustedRoots, isDistrusted } from '../lib/security/distrusted-roots'

const bundled = tls.rootCertificates
const listed = bundled.filter(isDistrusted)
const names = (pems: readonly string[]) => pems.map((pem) => DISTRUSTED_ROOTS[new X509Certificate(pem).fingerprint256]).sort()

check(Object.keys(DISTRUSTED_ROOTS).every((fingerprint) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(fingerprint)), 'each root is named by a SHA-256 fingerprint')
check(!isDistrusted('not a certificate'), 'text that is not a certificate is kept, not thrown on')
console.log(`  (Node.js ${process.version} lists ${listed.length} of them)`)

const before = tls.getCACertificates('default')
const dropped = dropDistrustedRoots()
const after = tls.getCACertificates('default')
eq(dropped.sort(), names(listed), 'it says which roots it took out: the ones this Node.js listed')
eq(after.filter(isDistrusted).length, 0, 'none of them is trusted any more')
eq(after.length, before.length - listed.length, 'and every other root still is')
const fingerprints = (pems: readonly string[]) => new Set(pems.map((pem) => new X509Certificate(pem).fingerprint256))
const beforeSet = fingerprints(before)
check([...fingerprints(after)].every((fingerprint) => beforeSet.has(fingerprint)), 'with nothing added')
eq(dropDistrustedRoots(), [], 'a second call changes nothing')

done('tls-roots')
