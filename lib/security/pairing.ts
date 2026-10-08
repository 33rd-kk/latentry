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
//
// Requests from this machine never need it, so a Latentry that listens only
// on 127.0.0.1 behaves exactly as before. LATENTRY_PAIRING=off turns it off
// for everyone (for a reverse proxy that does its own login).
//
// Run from proxy.ts (the check) and /api/pair, /api/settings/pairing (the rest).

import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
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

// The key is read from its file, and read again when the file changes: the
// proxy and the routes may not share a module instance, but they share it.
const globalForPairing = globalThis as typeof globalThis & {
  __pairingKey?: { file: string; mtimeMs: number; key: Buffer }
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

/** A new device cookie's value, good for DEVICE_DAYS from `now`. */
export function issueDevice(now = Date.now(), env: Env = process.env): { value: string; maxAgeSeconds: number } {
  const payload = `v1.${randomBytes(12).toString('base64url')}.${now + DEVICE_MS}`
  return { value: `${payload}.${signature(signingKey(env), payload)}`, maxAgeSeconds: DEVICE_MS / 1000 }
}

/** Whether a device cookie is one this key signed and has not expired. */
export function verifyDevice(value: string | undefined, now = Date.now(), env: Env = process.env): boolean {
  if (!value) return false
  const parts = value.split('.')
  if (parts.length !== 4 || parts[0] !== 'v1') return false
  const expiresAt = Number(parts[2])
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + DEVICE_MS) return false
  const expected = Buffer.from(signature(signingKey(env), parts.slice(0, 3).join('.')))
  const sent = Buffer.from(parts[3])
  return sent.length === expected.length && timingSafeEqual(sent, expected)
}

/** Forgets every paired device: a new key, so no cookie signed before verifies. */
export function forgetAllDevices(env: Env = process.env): void {
  const file = keyPath(env)
  const key = writeKey(file)
  globalForPairing.__pairingKey = { file, mtimeMs: statSync(file).mtimeMs, key }
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
