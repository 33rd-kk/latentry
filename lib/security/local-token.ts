// How a terminal in the container proves it is there, when loopback is not
// trusted (LATENTRY_TRUST_LOOPBACK=off, set by the Docker image).
//
// In a container, a port forwarder may hand over connections from other
// machines as if they came from 127.0.0.1 (rootless Docker and Podman can),
// so being on loopback proves nothing there. Instead, the server writes a
// random token to a file only its own user can read, outside the data volume,
// and scripts/local-api.mjs sends it with `npm run owner-code` and
// `npm run forget-devices`. Being able to read the file, that is to run a
// command in the container, is what the token proves. It admits those two
// actions only (app/api/settings/pairing/route.ts), never goes over the
// network or into a log, and is removed when the server stops.
//
//   LATENTRY_LOCAL_TOKEN_FILE   default: <temp dir>/latentry-local-token

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { restrictExistingToOwner } from '@/lib/security/owner-only'

type Env = Record<string, string | undefined>

/** The header the scripts send the token under. */
export const LOCAL_TOKEN_HEADER = 'x-latentry-local-token'

const globalForToken = globalThis as typeof globalThis & { __latentryLocalToken?: string }

/** Whether a request from loopback counts as this computer (on unless LATENTRY_TRUST_LOOPBACK=off). */
export function trustsLoopback(env: Env = process.env): boolean {
  return env.LATENTRY_TRUST_LOOPBACK?.trim().toLowerCase() !== 'off'
}

export function localTokenPath(env: Env = process.env): string {
  return path.resolve(/*turbopackIgnore: true*/ env.LATENTRY_LOCAL_TOKEN_FILE?.trim() || path.join(tmpdir(), 'latentry-local-token'))
}

/**
 * Writes a new token for this process, when loopback is not trusted. Whatever
 * is in its place (a file from an earlier run, or a link) is removed first,
 * never followed. Where that is not allowed (another user's file in the shared
 * temp folder, which its sticky bit protects), no token is made, so the
 * scripts say Latentry refused.
 */
export function writeLocalToken(env: Env = process.env): void {
  if (trustsLoopback(env)) return
  const file = localTokenPath(env)
  try {
    unlinkSync(file)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EPERM' || code === 'EACCES') {
      console.warn(`[security] ${path.basename(file)} is not this user's file; owner-code and forget-devices will not work`)
      return
    }
    if (code !== 'ENOENT') throw error
  }
  const token = randomBytes(32).toString('base64url')
  try {
    // 'wx' creates the file or fails; it never writes through a link someone
    // put there in between.
    writeFileSync(file, token, { mode: 0o600, flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    console.warn(`[security] ${path.basename(file)} came back while it was replaced; owner-code and forget-devices will not work`)
    return
  }
  restrictExistingToOwner(file)
  globalForToken.__latentryLocalToken = token
  process.once('exit', () => {
    try {
      unlinkSync(file)
    } catch {
      // Already gone.
    }
  })
}

/** Whether the request carries this process's token. */
export function hasLocalToken(headers: Headers): boolean {
  const token = globalForToken.__latentryLocalToken
  const sent = headers.get(LOCAL_TOKEN_HEADER)
  if (!token || !sent) return false
  const a = Buffer.from(sent)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}
