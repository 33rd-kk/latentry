// Pairing: which devices other than this machine may use Latentry.
//
// There is no login. Without this, anything that can reach the port -- every
// device on the LAN once LATENTRY_HOST opens it -- could start runs, stop
// them, read every picture and its prompt, and write tags into the files.
// So a request that does not come from this machine needs a device cookie,
// and a device gets one by typing a short code shown on this machine's
// Settings page:
//
//   code    8 characters, shown only on this machine; one use, 10 minutes,
//           CODE_TRIES wrong tries in all. Never put in a URL or a log, so
//           it is in no browser history and no terminal scrollback.
//   cookie  v1.<device id>.<expires at>.<HMAC-SHA256>, HttpOnly,
//           SameSite=Strict, good for 30 days. Signed with a random key kept
//           next to the settings file; a new key forgets every device. An
//           owner's starts o1 instead, and the browser keeps it OWNER_GRACE_DAYS
//           past its end, letting nothing in: only so the pairing page can
//           say this browser's owner pairing ended, and when.
//   list    latentry.pairing-devices.json, next to the key: per device its
//           id, the name it gave itself (or none), when it was paired and
//           when that ends. Nothing about its use is recorded. Encrypted, so
//           the file on its own -- in a backup, say -- shows no device names.
//
// The codes, the cookie, the key and the list are lib/pairing's, which is
// kept free of the app (see its README.md); this file gives it Latentry's
// files, names and settings.
//
// Requests from this machine never need it, so a Latentry that listens only
// on 127.0.0.1 behaves exactly as before.
//
// An owner device may also do what only this machine may (settings, Setup,
// pairing others): for a Latentry in a container, or on a computer used from
// another. Its code comes from an owner code, made only by a request from
// this machine -- a terminal on it, `npm run owner-code` -- so being able to
// run a command there is what makes an owner. Owner codes are 12 characters,
// kept apart from the others: a code is matched only against the kind its
// length says, so tries at a phone's code never touch the owner code. And an
// owner code has no count of tries to use up, so nobody on the network can
// spend it and keep the owner from pairing: 31^12 codes against /api/pair's
// 5 tries a minute per address make a guess hopeless within its 10 minutes.
// LATENTRY_PAIRING=off turns pairing off for everyone (for a reverse proxy
// that does its own login).
//
// Why not a library (looked at 2026-10, again 2026-11): the crypto here is
// node:crypto's own (HMAC-SHA256, AES-256-GCM, timingSafeEqual); only the flow
// is ours.
//   - Better Auth's device-authorization plugin (RFC 8628) is the nearest,
//     but it needs user accounts and a database, which Latentry has neither of.
//   - iron-session would seal the cookie, but the cookie holds nothing secret
//     (a device id and an expiry), and removing one device still needs the
//     list kept here.
//   - PairDrop, Paapi and the like pair devices to talk to each other, not
//     to be let in.
//
// Run from proxy.ts (the check) and /api/pair, /api/settings/pairing (the rest).

import path from 'node:path'
import { createCodeBook, createPairing, readCookie, type Pairing, type PairedDevice } from '@/lib/pairing'
import { settingsPath } from '@/lib/settings/store'

export { cleanName, MAX_NAME_LENGTH, normalizeCode, type PairedDevice } from '@/lib/pairing'

type Env = Record<string, string | undefined>

export const DEVICE_COOKIE = 'latentry_device'
export const DEVICE_DAYS = 30
// An owner device may change settings, so a copied owner cookie is worth more
// than another: it lasts a week, and only a new owner code renews it.
export const OWNER_DAYS = 7
export const OWNER_GRACE_DAYS = 7
export const CODE_MS = 10 * 60 * 1000
/**
 * Wrong tries an ordinary code takes before it is gone. With 5 tries a minute
 * per address, it takes many addresses to use them up, and even then a guess
 * succeeds about once in 10^10 codes.
 */
export const CODE_TRIES = 100
export const CODE_LENGTH = 8
export const OWNER_CODE_LENGTH = 12
/** What the list's key is derived with: part of the file format, never to change. */
const LIST_LABEL = 'latentry pairing devices v1'

const codes = createCodeBook({
  scope: 'latentry',
  length: CODE_LENGTH,
  ownerLength: OWNER_CODE_LENGTH,
  ttlMs: CODE_MS,
  tries: CODE_TRIES,
  // When, never the code or who tried: so whoever runs Latentry can tell
  // why the code stopped working, and that someone may be guessing.
  onUsedUp: (tries) => console.info(`[pairing] ${new Date().toISOString()} a pairing code was used up by ${tries} wrong tries; make a new one`),
})

export function pairingEnabled(env: Env = process.env): boolean {
  return env.LATENTRY_PAIRING?.trim().toLowerCase() !== 'off'
}

/** The key file: next to the settings file, so a test's scratch settings get their own. */
export function keyPath(env: Env = process.env): string {
  return path.join(path.dirname(settingsPath(env)), 'latentry.pairing-key')
}

/** The list of paired devices, next to the key. */
export function devicesPath(env: Env = process.env): string {
  return path.join(path.dirname(settingsPath(env)), 'latentry.pairing-devices.json')
}

/**
 * LATENTRY_PAIRING_KEY, when set: the key as 64 hex characters, read from a
 * keychain at launch so it is never on disk (docs/guide/network.md). Then no
 * key file is read or written.
 */
function keyFromEnv(env: Env): Buffer | undefined {
  const value = env.LATENTRY_PAIRING_KEY?.trim()
  if (!value) return undefined
  if (!/^(?:[0-9a-f]{2}){32,}$/i.test(value)) throw new Error('LATENTRY_PAIRING_KEY must be at least 64 hex characters (32 bytes)')
  return Buffer.from(value, 'hex')
}

/**
 * Owners coming and going, in the server's log, so whoever runs Latentry can
 * see an owner they did not add. Only the device's number and the time:
 * never a code, a name or an address.
 */
function logOwner(message: string): void {
  console.info(`[pairing] ${new Date().toISOString()} owner: ${message}`)
}

/** Latentry's files and lifetimes. Cheap to make: nothing is read until it is used. */
function pairingFor(env: Env): Pairing {
  return createPairing({
    keyFile: keyPath(env),
    devicesFile: devicesPath(env),
    key: keyFromEnv(env),
    listLabel: LIST_LABEL,
    deviceDays: DEVICE_DAYS,
    ownerDays: OWNER_DAYS,
    ownerGraceDays: OWNER_GRACE_DAYS,
    onOwnerEvent: logOwner,
  })
}

/** Paired devices that have not expired, oldest first. */
export function listDevices(now = Date.now(), env: Env = process.env): PairedDevice[] {
  return pairingFor(env).list(now)
}

/**
 * Pairs a new device, good for DEVICE_DAYS from `now` (OWNER_DAYS for an
 * owner): puts it on the list (dropping any that have expired) and returns
 * its cookie's value.
 */
export function issueDevice(
  now = Date.now(),
  env: Env = process.env,
  name: string | null = null,
  owner = false
): { value: string; maxAgeSeconds: number; device: PairedDevice } {
  return pairingFor(env).issue(now, name, owner)
}

/**
 * The paired device a cookie belongs to: signed with this key, not expired,
 * still on the list. A key that cannot be used (a malformed
 * LATENTRY_PAIRING_KEY) pairs nobody rather than failing every request.
 */
export function pairedDevice(value: string | undefined, now = Date.now(), env: Env = process.env): PairedDevice | null {
  try {
    return pairingFor(env).device(value, now)
  } catch (error) {
    console.error('Pairing:', error instanceof Error ? error.message : error)
    return null
  }
}

/**
 * When this browser's owner pairing ended, if it ended in the last
 * OWNER_GRACE_DAYS: for the pairing page to say so and show how to make a
 * new owner code. Lets nothing in. Null for anything else, including a
 * cookie signed before the devices were forgotten with a new key.
 */
export function endedOwner(value: string | undefined, now = Date.now(), env: Env = process.env): number | null {
  try {
    return pairingFor(env).endedOwner(value, now)
  } catch {
    return null
  }
}

/** Whether a device cookie belongs to a device that is paired now. */
export function verifyDevice(value: string | undefined, now = Date.now(), env: Env = process.env): boolean {
  return pairedDevice(value, now, env) !== null
}

/** Unpairs one device; false if it was not on the list. */
export function removeDevice(id: string, now = Date.now(), env: Env = process.env): boolean {
  return pairingFor(env).remove(id, now)
}

/**
 * Forgets every paired device: an empty list, and a new key when the key is
 * a file, so no cookie signed before verifies. A key from LATENTRY_PAIRING_KEY
 * stays (the empty list is enough); change it in the keychain to replace it.
 * The codes waiting to be used go too.
 */
export function forgetAllDevices(env: Env = process.env): void {
  pairingFor(env).forgetAll(Date.now())
  codes.forget()
}

/** A fresh pairing code, replacing any earlier one. */
export function createCode(now = Date.now()): { code: string; expiresAt: number } {
  return codes.create(now)
}

/**
 * A fresh owner code, replacing any earlier one. Kept apart from the
 * ordinary code: it is never shown on the Settings page, and making a code
 * for a phone there does not replace it. Only for a request from this
 * machine (app/api/settings/pairing), that is, a terminal on it.
 */
export function createOwnerCode(now = Date.now()): { code: string; expiresAt: number } {
  return codes.createOwner(now)
}

/**
 * Which code `input` is, if either: 'owner' for the owner code, 'device' for
 * the ordinary one, null for neither. Its length says which one it is tried
 * against (12 characters the owner code, any other length the ordinary one),
 * so a try never touches the other. A match uses that code up. A wrong try at
 * the ordinary code counts against its CODE_TRIES, after which it is gone and
 * a new one is needed; the owner code has no such count.
 */
export function redeemCode(input: string, now = Date.now()): 'owner' | 'device' | null {
  return codes.redeem(input, now)
}

/** The code waiting to be used, if any (for the Settings page on this machine). */
export function currentCode(now = Date.now()): { code: string; expiresAt: number } | null {
  return codes.current(now)
}

/** The device cookie from a Cookie header. */
export function deviceCookie(headers: Headers): string | undefined {
  return readCookie(headers.get('cookie'), DEVICE_COOKIE)
}

/** Paths a device that is not paired yet still needs: the pairing page and its API. */
export function isPairingPath(pathname: string): boolean {
  return pathname === '/pair' || pathname === '/api/pair' || pathname.startsWith('/_next/')
}
