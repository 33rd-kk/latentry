// SPDX-License-Identifier: MIT
//
// Paired devices: a signing key, a list of the devices let in, and the
// cookie each device carries. No accounts, no database: two small files.
//
//   key     32 random bytes as hex, in its own file (mode 0o600, and
//           owner-only on Windows too), or handed in from a keychain so it
//           is never on disk. A new key forgets every device.
//   cookie  v1.<device id>.<expires at>.<HMAC-SHA256 of the rest>; an
//           owner's starts o1. It holds nothing secret, only which device
//           and until when, and verifies only while that device is on the
//           list, so removing one unpairs that device alone.
//   list    per device its id, the name it gave itself (or none), a number
//           in pairing order, when it was paired and when that ends, and
//           whether it is an owner. Nothing about its use. Sealed with
//           AES-256-GCM under a key derived from the signing key, so the
//           file on its own (in a backup, say) shows no device names.
//           Whoever can read the key file too can read it.
//
// What an owner may do is the app's to decide; this only records who is one.
// Owner pairings last less (7 days by default), and a browser keeps an
// owner cookie a grace period past its end, letting nothing in, only so the
// app can say the owner pairing ended and when.
//
// Both files are read again when they change, so every module instance in
// the process sees the same devices.

import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { closeSync, fstatSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { restrictExistingToOwner, restrictToOwner } from './owner-only'

const DAY_MS = 24 * 60 * 60 * 1000
const DEVICE_TAG = 'v1'
const OWNER_TAG = 'o1'

export const MAX_NAME_LENGTH = 40

export interface PairedDevice {
  id: string
  /** What the device called itself when it paired; null for none. */
  name: string | null
  /** 1, 2, 3... in pairing order, for a device without a name. */
  number: number
  pairedAt: number
  expiresAt: number
  /** Paired as an owner. Lists written before owners existed read as false. */
  owner: boolean
}

export interface PairingOptions {
  /** The signing key's file. Not read or written when `key` is given. */
  keyFile: string
  /** The sealed list of paired devices. */
  devicesFile: string
  /** A key kept elsewhere, a keychain say: at least 32 bytes. Then there is no key file. */
  key?: Buffer
  /**
   * What the list's key is derived with. Part of the file format: a list
   * sealed under one label does not open under another.
   */
  listLabel?: string
  /** How long a device stays paired. Default 30. */
  deviceDays?: number
  /** How long an owner stays paired. Default 7. */
  ownerDays?: number
  /** How long past its end a browser keeps an owner cookie. Default 7. */
  ownerGraceDays?: number
  /** Owner pairings coming and going: device numbers and times only, never a name or an address. */
  onOwnerEvent?: (message: string) => void
}

export interface IssuedDevice {
  /** The cookie's value. */
  value: string
  /** How long the browser should keep the cookie. */
  maxAgeSeconds: number
  device: PairedDevice
}

export interface Pairing {
  /** Paired devices that have not expired, oldest first. */
  list(now?: number): PairedDevice[]
  /** Pairs a new device (dropping any that have expired) and returns its cookie. */
  issue(now?: number, name?: string | null, owner?: boolean): IssuedDevice
  /**
   * The paired device a cookie belongs to: signed with this key, not
   * expired, still on the list. Throws only when the key cannot be used.
   */
  device(cookie: string | undefined, now?: number): PairedDevice | null
  /** When this cookie's owner pairing ended, if within the grace period; it lets nothing in. */
  endedOwner(cookie: string | undefined, now?: number): number | null
  /** Unpairs one device; false if it was not on the list. */
  remove(id: string, now?: number): boolean
  /**
   * Forgets every device: an empty list, and a new key when the key is a
   * file, so no cookie signed before verifies. A key handed in stays.
   */
  forgetAll(now?: number): void
}

// The last key and list read, by file, with the time each file had then.
const globalForPairing = globalThis as typeof globalThis & {
  __pairingKey?: { file: string; mtimeMs: number; key: Buffer }
  /** `sealKey` is the key the list was opened with: another key must open it again. */
  __pairingDevices?: { file: string; mtimeMs: number; sealKey: Buffer; devices: PairedDevice[] }
}

/** "My phone" as typed: control characters out, spaces folded, at most MAX_NAME_LENGTH. */
export function cleanName(name: unknown): string | null {
  if (typeof name !== 'string') return null
  const cleaned = name.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH).trim()
  return cleaned || null
}

/** A new random key in `file`; with flag 'wx', only if there is no file yet. */
function writeKey(file: string, flag: 'w' | 'wx' = 'w'): Buffer {
  const key = randomBytes(32)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, key.toString('hex') + '\n', { mode: 0o600, flag })
  restrictToOwner(file)
  return key
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

export function createPairing(options: PairingOptions): Pairing {
  const { keyFile, devicesFile } = options
  const listLabel = options.listLabel ?? 'pairing devices v1'
  const deviceMs = (options.deviceDays ?? 30) * DAY_MS
  const ownerMs = (options.ownerDays ?? 7) * DAY_MS
  const ownerGraceMs = (options.ownerGraceDays ?? 7) * DAY_MS
  if (options.key && options.key.length < 32) throw new Error('A pairing key must be at least 32 bytes')
  const log = (message: string) => options.onOwnerEvent?.(message)

  function signingKey(): Buffer {
    if (options.key) return options.key
    const cached = globalForPairing.__pairingKey?.file === keyFile ? globalForPairing.__pairingKey : undefined
    const found = readIfChanged(keyFile, cached?.mtimeMs)
    if (found && found.text === null && cached) return cached.key
    const key = found?.text ? Buffer.from(found.text.trim(), 'hex') : null
    if (!found || !key || key.length < 32) return createKey(!found)
    globalForPairing.__pairingKey = { file: keyFile, mtimeMs: found.mtimeMs, key }
    return key
  }

  /**
   * Writes a new key. When there was no file (`fresh`), it is created only if
   * still absent, so two requests racing to make the first key cannot each
   * sign with their own; the loser reads the winner's.
   */
  function createKey(fresh: boolean): Buffer {
    try {
      const key = writeKey(keyFile, fresh ? 'wx' : 'w')
      // Not cached here: the next read takes the time and the key from one
      // handle, so a cache can never pair this key with another write's time.
      globalForPairing.__pairingKey = undefined
      return key
    } catch (error) {
      if (fresh && (error as NodeJS.ErrnoException).code === 'EEXIST') return signingKey()
      throw error
    }
  }

  /** The list's encryption key: derived from the signing key, so a new one makes the old list unreadable too. */
  const listKey = () => createHmac('sha256', signingKey()).update(listLabel).digest()

  function seal(devices: PairedDevice[]): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', listKey(), iv)
    const data = Buffer.concat([cipher.update(JSON.stringify(devices), 'utf8'), cipher.final()])
    return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }) + '\n'
  }

  function open(text: string, sealKey: Buffer): unknown {
    const sealed = JSON.parse(text) as { v?: unknown; iv?: unknown; tag?: unknown; data?: unknown }
    if (sealed.v !== 1 || typeof sealed.iv !== 'string' || typeof sealed.tag !== 'string' || typeof sealed.data !== 'string') return null
    const decipher = createDecipheriv('aes-256-gcm', sealKey, Buffer.from(sealed.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'))
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString('utf8'))
  }

  function readDevices(): PairedDevice[] {
    const sealKey = listKey()
    const last = globalForPairing.__pairingDevices
    const cached = last?.file === devicesFile && last.sealKey.equals(sealKey) ? last : undefined
    let found = readIfChanged(devicesFile, cached?.mtimeMs)
    if (!found) return []
    if (found.text === null && cached) return cached.devices
    // Unchanged, but last opened with another key: read the text after all.
    if (found.text === null) found = readIfChanged(devicesFile)
    if (!found) return []
    let devices: PairedDevice[] = []
    try {
      const parsed = open(found.text ?? '', sealKey)
      // Only a literal true makes an owner, so a list from before owners has none.
      if (Array.isArray(parsed)) devices = parsed.filter(isDevice).map((device) => ({ ...device, owner: device.owner === true }))
    } catch {
      // Unreadable, tampered with or sealed with another key: no device is
      // paired until the list is written again.
    }
    globalForPairing.__pairingDevices = { file: devicesFile, mtimeMs: found.mtimeMs, sealKey, devices }
    return devices
  }

  function writeDevices(devices: PairedDevice[]): void {
    mkdirSync(path.dirname(devicesFile), { recursive: true })
    const temp = `${devicesFile}.${process.pid}.tmp`
    writeFileSync(temp, seal(devices), { mode: 0o600 })
    restrictToOwner(temp)
    renameSync(temp, devicesFile)
    // Read back on next use (see createKey).
    globalForPairing.__pairingDevices = undefined
  }

  /** A cookie's id, end and kind, if this key signed it; whether it is still paired is not looked at. */
  function signedCookie(value: string | undefined): { id: string; expiresAt: number; owner: boolean } | null {
    if (!value) return null
    const parts = value.split('.')
    if (parts.length !== 4 || (parts[0] !== DEVICE_TAG && parts[0] !== OWNER_TAG)) return null
    const expiresAt = Number(parts[2])
    if (!Number.isSafeInteger(expiresAt)) return null
    const expected = Buffer.from(signature(signingKey(), parts.slice(0, 3).join('.')))
    const sent = Buffer.from(parts[3])
    if (sent.length !== expected.length || !timingSafeEqual(sent, expected)) return null
    return { id: parts[1], expiresAt, owner: parts[0] === OWNER_TAG }
  }

  const list = (now = Date.now()) => readDevices().filter((device) => device.expiresAt > now)

  return {
    list,

    issue(now = Date.now(), name = null, owner = false) {
      const current = list(now)
      const lifetime = owner ? ownerMs : deviceMs
      const device: PairedDevice = {
        id: randomBytes(12).toString('base64url'),
        name: cleanName(name),
        number: current.reduce((max, d) => Math.max(max, d.number), 0) + 1,
        pairedAt: now,
        expiresAt: now + lifetime,
        owner,
      }
      writeDevices([...current, device])
      if (owner) log(`device ${device.number} was paired as an owner, until ${new Date(device.expiresAt).toISOString()}`)
      const payload = `${owner ? OWNER_TAG : DEVICE_TAG}.${device.id}.${device.expiresAt}`
      const maxAge = owner ? lifetime + ownerGraceMs : lifetime
      return { value: `${payload}.${signature(signingKey(), payload)}`, maxAgeSeconds: maxAge / 1000, device }
    },

    device(cookie, now = Date.now()) {
      const signed = signedCookie(cookie)
      if (!signed || signed.expiresAt <= now || signed.expiresAt > now + Math.max(deviceMs, ownerMs)) return null
      // The tag is not matched against the list: owners paired before o1
      // existed carry v1 cookies, and either way the key signed it as issued.
      return list(now).find((device) => device.id === signed.id && device.expiresAt === signed.expiresAt) ?? null
    },

    endedOwner(cookie, now = Date.now()) {
      const signed = signedCookie(cookie)
      if (!signed?.owner || signed.expiresAt > now || signed.expiresAt <= now - ownerGraceMs) return null
      return signed.expiresAt
    },

    remove(id, now = Date.now()) {
      const current = list(now)
      const removed = current.find((device) => device.id === id)
      if (!removed) return false
      writeDevices(current.filter((device) => device !== removed))
      if (removed.owner) log(`device ${removed.number} was removed`)
      return true
    },

    forgetAll(now = Date.now()) {
      // Counted while the old key can still read the list.
      const owners = list(now).filter((device) => device.owner).length
      if (!options.key) {
        writeKey(keyFile)
        globalForPairing.__pairingKey = undefined
      }
      writeDevices([])
      if (owners) log(`every device was forgotten, ${owners} owner${owners === 1 ? '' : 's'} among them`)
    },
  }
}

/** A cookie's value from a Cookie header, or undefined. */
export function readCookie(header: string | null | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return undefined
}
