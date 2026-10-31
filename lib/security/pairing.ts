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
//           10 tries in all. Never put in a URL or a log, so it is in no
//           browser history and no terminal scrollback.
//   cookie  v1.<device id>.<expires at>.<HMAC-SHA256>, HttpOnly,
//           SameSite=Strict, good for 30 days. Signed with a random key kept
//           next to the settings file; a new key forgets every device. An
//           owner's starts o1 instead, and the browser keeps it OWNER_GRACE_DAYS
//           past its end, letting nothing in: only so the pairing page can
//           say this browser's owner pairing ended, and when.
//   list    latentry.pairing-devices.json, next to the key: per device its
//           id, the name it gave itself (or none), when it was paired and
//           when that ends. Nothing about its use is recorded. A cookie
//           verifies only while its device is on the list, so removing one
//           unpairs that device alone. Encrypted (AES-256-GCM, with a key
//           derived from the signing key), so the file on its own -- in a
//           backup, say -- shows no device names. Whoever can read the key
//           file too can read it; that is what the folder's permissions are for.
//
// Requests from this machine never need it, so a Latentry that listens only
// on 127.0.0.1 behaves exactly as before.
//
// An owner device may also do what only this machine may (settings, Setup,
// pairing others): for a Latentry in a container, or on a computer used from
// another. Its code comes from an owner code, made only by a request from
// this machine -- a terminal on it, `npm run owner-code` -- so being able to
// run a command there is what makes an owner. Owner codes follow the same
// rules as the others and are kept apart from them. LATENTRY_PAIRING=off turns it off
// for everyone (for a reverse proxy that does its own login).
//
// Why not a library (looked at 2026-10): the crypto here is node:crypto's
// own (HMAC-SHA256, AES-256-GCM, timingSafeEqual); only the flow is ours.
//   - Better Auth's device-authorization plugin (RFC 8628) is the nearest,
//     but it needs user accounts and a database, which Latentry has neither of.
//   - iron-session would seal the cookie, but the cookie holds nothing secret
//     (a device id and an expiry), and removing one device still needs the
//     list kept here.
//   - PairDrop, Paapi and the like pair devices to talk to each other, not
//     to be let in.
//
// Run from proxy.ts (the check) and /api/pair, /api/settings/pairing (the rest).

import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { closeSync, fstatSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { restrictExistingToOwner, restrictToOwner } from '@/lib/security/owner-only'
import { settingsPath } from '@/lib/settings/store'

type Env = Record<string, string | undefined>

export const DEVICE_COOKIE = 'latentry_device'
export const DEVICE_DAYS = 30
const DEVICE_MS = DEVICE_DAYS * 24 * 60 * 60 * 1000
// An owner device may change settings, so a copied owner cookie is worth more
// than another: it lasts a week, and only a new owner code renews it.
export const OWNER_DAYS = 7
const OWNER_MS = OWNER_DAYS * 24 * 60 * 60 * 1000
export const OWNER_GRACE_DAYS = 7
const OWNER_GRACE_MS = OWNER_GRACE_DAYS * 24 * 60 * 60 * 1000
const DEVICE_TAG = 'v1'
const OWNER_TAG = 'o1'
export const CODE_MS = 10 * 60 * 1000
export const CODE_TRIES = 10
// No 0/O, 1/I/L: read off one screen and typed on another.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 8

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

export interface PairedDevice {
  id: string
  /** What the device called itself when it paired; null for none. */
  name: string | null
  /** 1, 2, 3... in pairing order, for a device without a name. */
  number: number
  pairedAt: number
  expiresAt: number
  /**
   * An owner device may do what this machine may: change settings and Setup,
   * and pair other devices. Paired with an owner code, which only a terminal
   * on this machine can make (scripts/owner-code.mjs). Lists written before
   * owners existed read as false.
   */
  owner: boolean
}

export const MAX_NAME_LENGTH = 40

// The key and the list are read from their files, and read again when a file
// changes: the proxy and the routes may not share a module instance, but they
// share the files.
const globalForPairing = globalThis as typeof globalThis & {
  __pairingKey?: { file: string; mtimeMs: number; key: Buffer }
  __pairingDevices?: { file: string; mtimeMs: number; devices: PairedDevice[] }
  __pairingCode?: PendingCode | null
  __ownerCode?: PendingCode | null
}

type PendingCode = { code: string; expiresAt: number; triesLeft: number }

/** A new random key in `file`; with flag 'wx', only if there is no file yet. */
function writeKey(file: string, flag: 'w' | 'wx' = 'w'): Buffer {
  const key = randomBytes(32)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, key.toString('hex') + '\n', { mode: 0o600, flag })
  restrictToOwner(file)
  return key
}

/**
 * LATENTRY_PAIRING_KEY, when set: the key as 64 hex characters, read from a
 * keychain at launch so it is never on disk (docs/guide/network.md). Then no
 * key file is read or written.
 */
function keyFromEnv(env: Env): Buffer | null {
  const value = env.LATENTRY_PAIRING_KEY?.trim()
  if (!value) return null
  if (!/^(?:[0-9a-f]{2}){32,}$/i.test(value)) throw new Error('LATENTRY_PAIRING_KEY must be at least 64 hex characters (32 bytes)')
  return Buffer.from(value, 'hex')
}

/**
 * A file's modification time and, unless it is still `knownMtimeMs`, its
 * text; null when there is no such file. Both come from one open handle, so
 * the text is the version the time belongs to, whatever happens to the path.
 */
function readIfChanged(file: string, knownMtimeMs?: number): { mtimeMs: number; text: string | null } | null {
  let fd: number
  try {
    fd = openSync(file, 'r')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  restrictExistingToOwner(file)
  try {
    const { mtimeMs } = fstatSync(fd)
    return { mtimeMs, text: mtimeMs === knownMtimeMs ? null : readFileSync(fd, 'utf8') }
  } finally {
    closeSync(fd)
  }
}

function signingKey(env: Env = process.env): Buffer {
  const fromEnv = keyFromEnv(env)
  if (fromEnv) return fromEnv
  const file = keyPath(env)
  const cached = globalForPairing.__pairingKey?.file === file ? globalForPairing.__pairingKey : undefined
  const found = readIfChanged(file, cached?.mtimeMs)
  if (found && found.text === null && cached) return cached.key
  const key = found?.text ? Buffer.from(found.text.trim(), 'hex') : null
  if (!found || !key || key.length < 32) return createKey(file, !found, env)
  globalForPairing.__pairingKey = { file, mtimeMs: found.mtimeMs, key }
  return key
}

/**
 * Writes a new key. When there was no file (`fresh`), it is created only if
 * still absent, so two requests racing to make the first key cannot each
 * sign with their own; the loser reads the winner's.
 */
function createKey(file: string, fresh: boolean, env: Env): Buffer {
  try {
    const key = writeKey(file, fresh ? 'wx' : 'w')
    // Not cached here: the next read takes the time and the key from one
    // handle, so a cache can never pair this key with another write's time.
    globalForPairing.__pairingKey = undefined
    return key
  } catch (error) {
    if (fresh && (error as NodeJS.ErrnoException).code === 'EEXIST') return signingKey(env)
    throw error
  }
}

function signature(key: Buffer, payload: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url')
}

function isDevice(value: unknown): value is Omit<PairedDevice, 'owner'> & { owner?: unknown } {
  const d = value as PairedDevice
  return (
    !!d &&
    typeof d.id === 'string' &&
    (d.name === null || typeof d.name === 'string') &&
    Number.isSafeInteger(d.number) &&
    Number.isSafeInteger(d.pairedAt) &&
    Number.isSafeInteger(d.expiresAt)
  )
}

/** The list's encryption key: derived from the signing key, so a new one makes the old list unreadable too. */
function listKey(env: Env): Buffer {
  return createHmac('sha256', signingKey(env)).update('latentry pairing devices v1').digest()
}

function encryptList(devices: PairedDevice[], env: Env): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', listKey(env), iv)
  const data = Buffer.concat([cipher.update(JSON.stringify(devices), 'utf8'), cipher.final()])
  return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }) + '\n'
}

function decryptList(text: string, env: Env): unknown {
  const sealed = JSON.parse(text) as { v?: unknown; iv?: unknown; tag?: unknown; data?: unknown }
  if (sealed.v !== 1 || typeof sealed.iv !== 'string' || typeof sealed.tag !== 'string' || typeof sealed.data !== 'string') return null
  const decipher = createDecipheriv('aes-256-gcm', listKey(env), Buffer.from(sealed.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'))
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString('utf8'))
}

function readDevices(env: Env): PairedDevice[] {
  const file = devicesPath(env)
  const cached = globalForPairing.__pairingDevices?.file === file ? globalForPairing.__pairingDevices : undefined
  const found = readIfChanged(file, cached?.mtimeMs)
  if (!found) return []
  if (found.text === null && cached) return cached.devices
  let devices: PairedDevice[] = []
  try {
    const parsed = decryptList(found.text ?? '', env)
    // Only a literal true makes an owner, so a list from before owners has none.
    if (Array.isArray(parsed)) devices = parsed.filter(isDevice).map((device) => ({ ...device, owner: device.owner === true }))
  } catch {
    // Unreadable, tampered with or sealed with another key: no device is
    // paired until the list is written again.
  }
  globalForPairing.__pairingDevices = { file, mtimeMs: found.mtimeMs, devices }
  return devices
}

function writeDevices(devices: PairedDevice[], env: Env): void {
  const file = devicesPath(env)
  mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  writeFileSync(temp, encryptList(devices, env), { mode: 0o600 })
  restrictToOwner(temp)
  renameSync(temp, file)
  // Read back on next use (see createKey).
  globalForPairing.__pairingDevices = undefined
}

/** "My phone" as typed: control characters out, spaces folded, at most MAX_NAME_LENGTH. */
export function cleanName(name: unknown): string | null {
  if (typeof name !== 'string') return null
  const cleaned = name.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH).trim()
  return cleaned || null
}

/** Paired devices that have not expired, oldest first. */
export function listDevices(now = Date.now(), env: Env = process.env): PairedDevice[] {
  return readDevices(env).filter((device) => device.expiresAt > now)
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
  const current = listDevices(now, env)
  const lifetime = owner ? OWNER_MS : DEVICE_MS
  const device: PairedDevice = {
    id: randomBytes(12).toString('base64url'),
    name: cleanName(name),
    number: current.reduce((max, d) => Math.max(max, d.number), 0) + 1,
    pairedAt: now,
    expiresAt: now + lifetime,
    owner,
  }
  writeDevices([...current, device], env)
  if (owner) logOwner(`device ${device.number} was paired as an owner, until ${new Date(device.expiresAt).toISOString()}`)
  const payload = `${owner ? OWNER_TAG : DEVICE_TAG}.${device.id}.${device.expiresAt}`
  const maxAge = owner ? lifetime + OWNER_GRACE_MS : lifetime
  return { value: `${payload}.${signature(signingKey(env), payload)}`, maxAgeSeconds: maxAge / 1000, device }
}

/**
 * Owners coming and going, in the server's log, so whoever runs Latentry can
 * see an owner they did not add. Only the device's number and the time:
 * never a code, a name or an address.
 */
function logOwner(message: string): void {
  console.info(`[pairing] ${new Date().toISOString()} owner: ${message}`)
}

/**
 * The paired device a cookie belongs to: signed with this key, not expired,
 * still on the list. A key that cannot be used (a malformed
 * LATENTRY_PAIRING_KEY) pairs nobody rather than failing every request.
 */
export function pairedDevice(value: string | undefined, now = Date.now(), env: Env = process.env): PairedDevice | null {
  try {
    return findDevice(value, now, env)
  } catch (error) {
    console.error('Pairing:', error instanceof Error ? error.message : error)
    return null
  }
}

function findDevice(value: string | undefined, now: number, env: Env): PairedDevice | null {
  const cookie = signedCookie(value, env)
  if (!cookie || cookie.expiresAt <= now || cookie.expiresAt > now + Math.max(DEVICE_MS, OWNER_MS)) return null
  // The tag is not matched against the list: owners paired before o1
  // existed carry v1 cookies, and either way the key signed it as issued.
  return listDevices(now, env).find((device) => device.id === cookie.id && device.expiresAt === cookie.expiresAt) ?? null
}

/** A cookie's id, end and kind, if this key signed it; whether it is still paired is not looked at. */
function signedCookie(value: string | undefined, env: Env): { id: string; expiresAt: number; owner: boolean } | null {
  if (!value) return null
  const parts = value.split('.')
  if (parts.length !== 4 || (parts[0] !== DEVICE_TAG && parts[0] !== OWNER_TAG)) return null
  const expiresAt = Number(parts[2])
  if (!Number.isSafeInteger(expiresAt)) return null
  const expected = Buffer.from(signature(signingKey(env), parts.slice(0, 3).join('.')))
  const sent = Buffer.from(parts[3])
  if (sent.length !== expected.length || !timingSafeEqual(sent, expected)) return null
  return { id: parts[1], expiresAt, owner: parts[0] === OWNER_TAG }
}

/**
 * When this browser's owner pairing ended, if it ended in the last
 * OWNER_GRACE_DAYS: for the pairing page to say so and show how to make a
 * new owner code. Lets nothing in. Null for anything else, including a
 * cookie signed before the devices were forgotten with a new key.
 */
export function endedOwner(value: string | undefined, now = Date.now(), env: Env = process.env): number | null {
  try {
    const cookie = signedCookie(value, env)
    if (!cookie?.owner || cookie.expiresAt > now || cookie.expiresAt <= now - OWNER_GRACE_MS) return null
    return cookie.expiresAt
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
  const current = listDevices(now, env)
  const removed = current.find((device) => device.id === id)
  if (!removed) return false
  writeDevices(
    current.filter((device) => device !== removed),
    env
  )
  if (removed.owner) logOwner(`device ${removed.number} was removed`)
  return true
}

/**
 * Forgets every paired device: an empty list, and a new key when the key is
 * a file, so no cookie signed before verifies. A key from LATENTRY_PAIRING_KEY
 * stays (the empty list is enough); change it in the keychain to replace it.
 */
export function forgetAllDevices(env: Env = process.env): void {
  // Counted while the old key can still read the list.
  const owners = listDevices(Date.now(), env).filter((device) => device.owner).length
  if (!keyFromEnv(env)) {
    writeKey(keyPath(env))
    globalForPairing.__pairingKey = undefined
  }
  writeDevices([], env)
  globalForPairing.__pairingCode = null
  globalForPairing.__ownerCode = null
  if (owners) logOwner(`every device was forgotten, ${owners} owner${owners === 1 ? '' : 's'} among them`)
}

function newCode(now: number): PendingCode {
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  return { code, expiresAt: now + CODE_MS, triesLeft: CODE_TRIES }
}

/** A fresh pairing code, replacing any earlier one. */
export function createCode(now = Date.now()): { code: string; expiresAt: number } {
  const { code, expiresAt } = (globalForPairing.__pairingCode = newCode(now))
  return { code, expiresAt }
}

/**
 * A fresh owner code, replacing any earlier one. Kept apart from the
 * ordinary code: it is never shown on the Settings page, and making a code
 * for a phone there does not replace it. Only for a request from this
 * machine (app/api/settings/pairing), that is, a terminal on it.
 */
export function createOwnerCode(now = Date.now()): { code: string; expiresAt: number } {
  const { code, expiresAt } = (globalForPairing.__ownerCode = newCode(now))
  return { code, expiresAt }
}

/** "abcd-efgh" as typed -> "ABCDEFGH". */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * Which code `input` is, if either: 'owner' for the owner code, 'device' for
 * the ordinary one, null for neither. A match uses that code up and leaves
 * the other alone, so pairing a phone does not cost the owner code a try. A
 * wrong code counts against each waiting code's CODE_TRIES, after which it is
 * gone and a new one is needed.
 */
export function redeemCode(input: string, now = Date.now()): 'owner' | 'device' | null {
  const owner = waiting('__ownerCode', now)
  const device = waiting('__pairingCode', now)
  if (owner && matches(owner, input)) {
    globalForPairing.__ownerCode = null
    return 'owner'
  }
  if (device && matches(device, input)) {
    globalForPairing.__pairingCode = null
    return 'device'
  }
  for (const [slot, code] of [['__ownerCode', owner], ['__pairingCode', device]] as const) {
    if (code && --code.triesLeft <= 0) globalForPairing[slot] = null
  }
  return null
}

/** The code in `slot` if it has not expired; an expired one is dropped. */
function waiting(slot: '__pairingCode' | '__ownerCode', now: number): PendingCode | null {
  const current = globalForPairing[slot]
  if (current && current.expiresAt <= now) globalForPairing[slot] = null
  return globalForPairing[slot] ?? null
}

function matches(code: PendingCode, input: string): boolean {
  const sent = Buffer.from(normalizeCode(input).padEnd(CODE_LENGTH).slice(0, 64))
  const expected = Buffer.from(code.code)
  return sent.length === expected.length && timingSafeEqual(sent, expected)
}

/** The code waiting to be used, if any (for the Settings page on this machine). */
export function currentCode(now = Date.now()): { code: string; expiresAt: number } | null {
  const current = globalForPairing.__pairingCode
  if (!current || current.expiresAt <= now) return null
  return { code: current.code, expiresAt: current.expiresAt }
}

/** The device cookie from a Cookie header. */
export function deviceCookie(headers: Headers): string | undefined {
  for (const part of (headers.get('cookie') ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === DEVICE_COOKIE) return rest.join('=')
  }
  return undefined
}

/** Paths a device that is not paired yet still needs: the pairing page and its API. */
export function isPairingPath(pathname: string): boolean {
  return pathname === '/pair' || pathname === '/api/pair' || pathname.startsWith('/_next/')
}
