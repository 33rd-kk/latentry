/**
 * lib/pairing on its own: codes, cookies, the sealed list, and files written
 * by the version before it was split out (fixtures/pairing). Imports nothing
 * of the app, so it can go along with the folder when it becomes a package.
 * The app's use of it (proxy.ts, the routes) is pairing.verify.ts.
 *
 * Run with: npm test -- pairing-core
 */
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { check, done, eq } from './assert'
import {
  CODE_ALPHABET,
  cleanName,
  createCodeBook,
  createPairing,
  MAX_NAME_LENGTH,
  normalizeCode,
  readCookie,
  type PairingOptions,
} from '../lib/pairing'

const DAY = 86_400_000
const scratch = mkdtempSync(path.join(tmpdir(), 'pairing-core-'))
const fixtures = path.join(__dirname, 'fixtures', 'pairing')

function options(dir: string, more: Partial<PairingOptions> = {}): PairingOptions {
  return { keyFile: path.join(dir, 'key'), devicesFile: path.join(dir, 'devices.json'), ...more }
}

function fresh(name: string): string {
  return mkdtempSync(path.join(scratch, `${name}-`))
}

async function main(): Promise<void> {
  // ── Files written before the split: still read, cookies still verify ──
  // Latentry's names for them, and the label its list was sealed under.
  const latentry = (dir: string, more: Partial<PairingOptions> = {}): PairingOptions => ({
    keyFile: path.join(dir, 'latentry.pairing-key'),
    devicesFile: path.join(dir, 'latentry.pairing-devices.json'),
    listLabel: 'latentry pairing devices v1',
    ...more,
  })
  for (const [kind, key] of [
    ['key-file', undefined],
    ['key-from-env', Buffer.from('ab'.repeat(32), 'hex')],
  ] as const) {
    const dir = fresh(kind)
    cpSync(path.join(fixtures, kind), dir, { recursive: true })
    const cookies = JSON.parse(readFileSync(path.join(dir, 'cookies.json'), 'utf8')) as { now: number; phone: string; owner: string; removed: string }
    const pairing = createPairing(latentry(dir, { key }))
    const now = cookies.now + 5000
    const phone = pairing.device(cookies.phone, now)
    eq(phone && { name: phone.name, number: phone.number, owner: phone.owner }, { name: 'Test phone', number: 1, owner: false }, `${kind}: an earlier phone's cookie still lets it in`)
    eq(pairing.device(cookies.owner, now)?.owner, true, `${kind}: so does an earlier owner's, as an owner`)
    eq(pairing.device(cookies.removed, now), null, `${kind}: a device removed then stays out`)
    eq(pairing.list(now).length, 2, `${kind}: the list reads as it was written`)
    check(pairing.device(cookies.phone, cookies.now + 31 * DAY) === null, `${kind}: and its end is kept`)
    eq(createPairing(latentry(dir, { key, listLabel: 'another app' })).list(now).length, 0, `${kind}: the label is part of the format`)
    if (key) check(!existsSync(path.join(dir, 'latentry.pairing-key')), 'a key handed in writes no key file')
  }

  // ── Codes ──
  const used: number[] = []
  const codes = createCodeBook({ scope: 'core-test', tries: 3, onUsedUp: (tries) => used.push(tries) })
  const now = 1_800_000_000_000
  const first = codes.create(now)
  check(first.code.length === 8 && [...first.code].every((c) => CODE_ALPHABET.includes(c)), 'a code is 8 characters from the alphabet')
  eq(first.expiresAt, now + 10 * 60 * 1000, 'and good for 10 minutes')
  eq(codes.current(now), first, 'it is the one waiting')
  const typed = `${first.code.slice(0, 4).toLowerCase()}-${first.code.slice(4)}`
  eq(normalizeCode(typed), first.code, 'typed with a dash and in lower case, it is the same code')
  eq(codes.redeem(typed, now), 'device', 'and it lets one device in')
  eq(codes.redeem(typed, now), null, 'once')
  eq(codes.current(now), null, 'then no code waits')

  const second = codes.create(now)
  const wrong = second.code.replace(/^./, (c) => (c === 'A' ? 'B' : 'A'))
  eq([codes.redeem(wrong, now), codes.redeem(wrong, now)], [null, null], 'wrong tries let nobody in')
  check(codes.current(now) !== null, 'and the code waits while tries are left')
  codes.redeem(wrong, now)
  eq(codes.redeem(second.code, now), null, 'after its tries the code is gone, right or not')
  eq(used, [3], 'and the app is told, with how many tries it took')

  const owner = codes.createOwner(now)
  const ordinary = codes.create(now)
  eq(owner.code.length, 12, 'an owner code is 12 characters')
  for (let i = 0; i < 10; i++) codes.redeem('X'.repeat(12), now)
  eq(codes.redeem(ordinary.code, now), 'device', 'tries at the owner code never touch the ordinary one')
  eq(codes.redeem(owner.code, now), 'owner', 'and the owner code has no count to use up')
  codes.create(now)
  eq(codes.redeem(codes.current(now)!.code, now + 10 * 60 * 1000), null, 'a code past its time lets nobody in')
  codes.create(now)
  codes.forget()
  eq(codes.current(now), null, 'forget drops the codes')
  const elsewhere = createCodeBook({ scope: 'core-test-other' })
  const apart = elsewhere.create(now)
  eq(codes.redeem(apart.code, now), null, 'books with other scopes are kept apart')
  let threw = false
  try {
    createCodeBook({ length: 10, ownerLength: 10 })
  } catch {
    threw = true
  }
  check(threw, 'an owner code the same length as an ordinary one is refused')

  // ── Devices and cookies ──
  const dir = fresh('devices')
  const events: string[] = []
  const pairing = createPairing(options(dir, { onOwnerEvent: (message) => events.push(message) }))
  const phone = pairing.issue(now, '  My\u0000 phone  ')
  eq(phone.device.name, 'My phone', 'a name is cleaned as it is stored')
  eq(phone.maxAgeSeconds, 30 * 24 * 60 * 60, 'a device stays 30 days by default')
  check(/^v1\.[\w-]+\.\d+\.[\w-]+$/.test(phone.value), 'its cookie is v1.<id>.<end>.<signature>')
  check(readFileSync(options(dir).keyFile, 'utf8').trim().length === 64, 'a 32-byte key is written on first use')
  check(!readFileSync(options(dir).devicesFile, 'utf8').includes('My phone'), 'the list on disk shows no names')
  eq(pairing.device(phone.value, now)?.id, phone.device.id, 'the cookie lets its device in')
  const [tag, id, end, sig] = phone.value.split('.')
  eq(pairing.device([tag, id, String(Number(end) + DAY), sig].join('.'), now), null, 'a later end written in breaks the signature')
  eq(pairing.device([tag, 'someone', end, sig].join('.'), now), null, 'so does another id')
  eq(pairing.device(undefined, now), null, 'no cookie is no device')
  eq(pairing.device(phone.value, now + 30 * DAY), null, 'not past its end')

  const boss = pairing.issue(now, null, true)
  check(boss.value.startsWith('o1.'), 'an owner cookie is tagged o1')
  eq(boss.maxAgeSeconds, 14 * 24 * 60 * 60, 'kept by the browser a grace period past its 7 days')
  eq(boss.device.number, 2, 'devices are numbered in pairing order')
  eq(pairing.endedOwner(boss.value, now), null, 'an owner pairing going on has not ended')
  eq(pairing.endedOwner(boss.value, now + 8 * DAY), now + 7 * DAY, 'after its end, the end is told')
  eq(pairing.endedOwner(boss.value, now + 15 * DAY), null, 'but not past the grace period')
  eq(pairing.device(boss.value, now + 8 * DAY), null, 'and it lets nothing in')
  eq(events.length, 1, 'an owner pairing is told to the app')
  check(!events[0].includes('My phone') && events[0].includes('device 2'), 'by its number, never a name')

  check(pairing.remove(phone.device.id, now), 'one device can be removed')
  eq(pairing.device(phone.value, now), null, 'and its cookie lets it in no more')
  check(!pairing.remove(phone.device.id, now), 'removing it again finds nothing')
  const kept = pairing.issue(now)
  pairing.forgetAll(now)
  eq([pairing.device(kept.value, now), pairing.list(now).length], [null, 0], 'forgetting all: no cookie signed before lets anyone in')
  check(pairing.device(pairing.issue(now).value, now) !== null, 'one issued after does')

  const handed = Buffer.alloc(32, 7)
  const handedDir = fresh('handed')
  const keyed = createPairing(options(handedDir, { key: handed }))
  const keyedPhone = keyed.issue(now)
  keyed.forgetAll(now)
  check(keyed.list(now).length === 0 && !existsSync(options(handedDir).keyFile), 'with a key handed in, forgetting empties the list and writes no key')
  eq(keyed.device(keyedPhone.value, now), null, 'and the old cookies stay out, since their devices are off the list')
  threw = false
  try {
    createPairing(options(fresh('short'), { key: Buffer.alloc(16) }))
  } catch {
    threw = true
  }
  check(threw, 'a key shorter than 32 bytes is refused')
  const short = createPairing(options(fresh('lifetimes'), { deviceDays: 1 }))
  eq(short.issue(now).maxAgeSeconds, 24 * 60 * 60, 'lifetimes are the app\'s to set')

  // ── Small helpers ──
  eq(cleanName('a'.repeat(MAX_NAME_LENGTH + 10))?.length, MAX_NAME_LENGTH, 'a name is cut to the longest kept')
  eq([cleanName(''), cleanName(42), cleanName(' ​ ')], [null, null, null], 'an empty or odd name is no name')
  eq(readCookie('a=1; device=v1.x.2.sig=; b=3', 'device'), 'v1.x.2.sig=', 'a cookie is read from the header, = and all')
  eq(readCookie(null, 'device'), undefined, 'and is missing from no header')

  // ── The folder's rules: what lets it become a package ──
  const folder = path.join(__dirname, '..', 'lib', 'pairing')
  for (const file of readdirSync(folder).filter((name) => name.endsWith('.ts'))) {
    const text = readFileSync(path.join(folder, file), 'utf8')
    check(text.startsWith('// SPDX-License-Identifier: MIT'), `${file} starts with its SPDX line`)
    check(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text), `${file} holds no control characters`)
    const imports = [...text.matchAll(/from '([^']+)'/g)].map((match) => match[1])
    check(imports.every((name) => name.startsWith('node:') || name.startsWith('./')), `${file} imports only node: and its own files`)
  }

  rmSync(scratch, { recursive: true, force: true })
  done('pairing-core')
}

void main()
