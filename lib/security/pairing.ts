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
//           next to the settings file; a new key forgets every device.
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
// on 127.0.0.1 behaves exactly as before. LATENTRY_PAIRING=off turns it off
// for everyone (for a reverse proxy that does its own login).
//
// Run from proxy.ts (the check) and /api/pair, /api/settings/pairing (the rest).

import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { settingsPath } from '@/lib/settings/store'

type Env = Record<string, string | undefined>

export const DEVICE_COOKIE = 'latentry_device'
export const DEVICE_DAYS = 30
const DEVICE_MS = DEVICE_DAYS * 24 * 60 * 60 * 1000
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
}

export const MAX_NAME_LENGTH = 40

// The key and the list are read from their files, and read again when a file
// changes: the proxy and the routes may not share a module instance, but they
// share the files.
const globalForPairing = globalThis as typeof globalThis & {
  __pairingKey?: { file: string; mtimeMs: number; key: Buffer }
  __pairingDevices?: { file: string; mtimeMs: number; devices: PairedDevice[] }
  __pairingCode?: { code: string; expiresAt: number; triesLeft: number } | null
}

function writeKey(file: string): Buffer {
  const key = randomBytes(32)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, key.toString('hex') + '\n', { mode: 0o600 })
  return key
}

function signingKey(env: Env = process.env): Buffer {
  const file = keyPath(env)
  const stat = statSync(file, { throwIfNoEntry: false })
  const cached = globalForPairing.__pairingKey
  if (stat && cached && cached.file === file && cached.mtimeMs === stat.mtimeMs) return cached.key
  let key: Buffer
  if (stat) {
    key = Buffer.from(readFileSync(file, 'utf8').trim(), 'hex')
    if (key.length < 32) key = writeKey(file)
  } else {
    key = writeKey(file)
  }
  globalForPairing.__pairingKey = { file, mtimeMs: statSync(file).mtimeMs, key }
  return key
}

function signature(key: Buffer, payload: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url')
}

function isDevice(value: unknown): value is PairedDevice {
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
  const stat = statSync(file, { throwIfNoEntry: false })
  if (!stat) return []
  const cached = globalForPairing.__pairingDevices
  if (cached && cached.file === file && cached.mtimeMs === stat.mtimeMs) return cached.devices
  let devices: PairedDevice[] = []
  try {
    const parsed = decryptList(readFileSync(file, 'utf8'), env)
    if (Array.isArray(parsed)) devices = parsed.filter(isDevice)
  } catch {
    // Unreadable, tampered with or sealed with another key: no device is
    // paired until the list is written again.
  }
  globalForPairing.__pairingDevices = { file, mtimeMs: stat.mtimeMs, devices }
  return devices
}

function writeDevices(devices: PairedDevice[], env: Env): void {
  const file = devicesPath(env)
  mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  writeFileSync(temp, encryptList(devices, env), { mode: 0o600 })
  renameSync(temp, file)
  globalForPairing.__pairingDevices = { file, mtimeMs: statSync(file).mtimeMs, devices }
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
 * Pairs a new device, good for DEVICE_DAYS from `now`: puts it on the list
 * (dropping any that have expired) and returns its cookie's value.
 */
export function issueDevice(
  now = Date.now(),
  env: Env = process.env,
  name: string | null = null
): { value: string; maxAgeSeconds: number; device: PairedDevice } {
  const current = listDevices(now, env)
  const device: PairedDevice = {
    id: randomBytes(12).toString('base64url'),
    name: cleanName(name),
    number: current.reduce((max, d) => Math.max(max, d.number), 0) + 1,
    pairedAt: now,
    expiresAt: now + DEVICE_MS,
  }
  writeDevices([...current, device], env)
  const payload = `v1.${device.id}.${device.expiresAt}`
  return { value: `${payload}.${signature(signingKey(env), payload)}`, maxAgeSeconds: DEVICE_MS / 1000, device }
}

/** The paired device a cookie belongs to: signed with this key, not expired, still on the list. */
export function pairedDevice(value: string | undefined, now = Date.now(), env: Env = process.env): PairedDevice | null {
  if (!value) return null
  const parts = value.split('.')
  if (parts.length !== 4 || parts[0] !== 'v1') return null
  const expiresAt = Number(parts[2])
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + DEVICE_MS) return null
  const expected = Buffer.from(signature(signingKey(env), parts.slice(0, 3).join('.')))
  const sent = Buffer.from(parts[3])
  if (sent.length !== expected.length || !timingSafeEqual(sent, expected)) return null
  return listDevices(now, env).find((device) => device.id === parts[1] && device.expiresAt === expiresAt) ?? null
}

/** Whether a device cookie belongs to a device that is paired now. */
export function verifyDevice(value: string | undefined, now = Date.now(), env: Env = process.env): boolean {
  return pairedDevice(value, now, env) !== null
}

/** Unpairs one device; false if it was not on the list. */
export function removeDevice(id: string, now = Date.now(), env: Env = process.env): boolean {
  const current = listDevices(now, env)
  const kept = current.filter((device) => device.id !== id)
  if (kept.length === current.length) return false
  writeDevices(kept, env)
  return true
}

/** Forgets every paired device: an empty list and a new key, so no cookie signed before verifies. */
export function forgetAllDevices(env: Env = process.env): void {
  const file = keyPath(env)
  const key = writeKey(file)
  globalForPairing.__pairingKey = { file, mtimeMs: statSync(file).mtimeMs, key }
  writeDevices([], env)
  globalForPairing.__pairingCode = null
}

/** A fresh pairing code, replacing any earlier one. */
export function createCode(now = Date.now()): { code: string; expiresAt: number } {
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  globalForPairing.__pairingCode = { code, expiresAt: now + CODE_MS, triesLeft: CODE_TRIES }
  return { code, expiresAt: now + CODE_MS }
}

/** "abcd-efgh" as typed -> "ABCDEFGH". */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * Whether `input` is the current code. A match uses it up; every try counts
 * against CODE_TRIES, after which the code is gone and a new one is needed.
 */
export function redeemCode(input: string, now = Date.now()): boolean {
  const current = globalForPairing.__pairingCode
  if (!current) return false
  if (current.expiresAt <= now) {
    globalForPairing.__pairingCode = null
    return false
  }
  current.triesLeft -= 1
  const sent = Buffer.from(normalizeCode(input).padEnd(CODE_LENGTH).slice(0, 64))
  const expected = Buffer.from(current.code)
  const match = sent.length === expected.length && timingSafeEqual(sent, expected)
  if (match || current.triesLeft <= 0) globalForPairing.__pairingCode = null
  return match
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
