/**
 * Pairing (lib/security/pairing.ts) and its place in proxy.ts: devices other
 * than this machine need a signed cookie, got with a one-use code.
 * G1 in the API audit (2026-10); see audit/2026-10-api-audit.md (local, not committed).
 *
 * Run with: npm test -- pairing
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { check, done, eq } from './assert'
import {
  cleanName,
  CODE_MS,
  CODE_TRIES,
  createCode,
  currentCode,
  DEVICE_COOKIE,
  deviceCookie,
  devicesPath,
  forgetAllDevices,
  isPairingPath,
  issueDevice,
  keyPath,
  listDevices,
  MAX_NAME_LENGTH,
  normalizeCode,
  pairedDevice,
  pairingEnabled,
  redeemCode,
  removeDevice,
  verifyDevice,
} from '../lib/security/pairing'
import { installPeerStamp, peerHeaderName } from '../lib/security/peer'
import { engineEnv } from '../lib/engine/supervisor'
import { DELETE as unpairRoute, GET as thisDeviceRoute, POST as pairRoute } from '../app/api/pair/route'
import { GET as pairingSettings, POST as pairingAction } from '../app/api/settings/pairing/route'
import { proxy } from '../proxy'

const scratch = mkdtempSync(path.join(tmpdir(), 'latentry-pairing-'))
process.env.LATENTRY_SETTINGS_FILE = path.join(scratch, 'settings.json')
delete process.env.LATENTRY_PAIRING

async function main(): Promise<void> {
  // ── The key ──
  eq(keyPath(), path.join(scratch, 'latentry.pairing-key'), 'the key sits next to the settings file')
  const now = 1_800_000_000_000
  const device = issueDevice(now)
  check(readFileSync(keyPath(), 'utf8').trim().length === 64, 'a 32-byte key is written on first use')
  eq(device.maxAgeSeconds, 30 * 24 * 60 * 60, 'a device cookie lasts 30 days')

  // ── Device cookies ──
  check(verifyDevice(device.value, now), 'a cookie just issued verifies')
  check(verifyDevice(device.value, now + 29 * 24 * 3600 * 1000), 'and still on day 29')
  check(!verifyDevice(device.value, now + 30 * 24 * 3600 * 1000 + 1), 'not after 30 days')
  check(!verifyDevice(undefined, now) && !verifyDevice('', now), 'no cookie is not a device')
  const [v, id, expires, sig] = device.value.split('.')
  check(!verifyDevice([v, id, String(Number(expires) + 86_400_000), sig].join('.'), now), 'a later expiry written in breaks the signature')
  check(!verifyDevice([v, 'someone', expires, sig].join('.'), now), 'so does another device id')
  check(!verifyDevice([v, id, expires, sig.slice(0, -2) + (sig.endsWith('AA') ? 'BB' : 'AA')].join('.'), now), 'and a changed signature')
  check(!verifyDevice([v, id, expires].join('.'), now), 'and a missing one')
  check(!verifyDevice(['v1', id, String(now + 10 * 365 * 86_400_000)].join('.') + '.' + sig, now), 'an expiry beyond 30 days is refused outright')
  forgetAllDevices()
  check(!verifyDevice(device.value, now), 'forgetting every device: a cookie signed before no longer verifies')
  check(verifyDevice(issueDevice(now).value, now), 'one issued after does')

  // ── The list of devices ──
  forgetAllDevices()
  eq(listDevices(now).length, 0, 'forgetting every device empties the list')
  const phone = issueDevice(now, process.env, '  My\u0000 phone\n ')
  const tablet = issueDevice(now + 1000, process.env, null)
  eq(phone.device.name, 'My phone', 'a name is kept without control characters or extra spaces')
  eq(tablet.device.name, null, 'a device may give no name')
  eq([phone.device.number, tablet.device.number], [1, 2], 'devices are numbered in pairing order')
  eq(cleanName('x'.repeat(100))?.length, MAX_NAME_LENGTH, `a name is cut to ${MAX_NAME_LENGTH} characters`)
  eq(listDevices(now + 2000).map((d) => d.id), [phone.device.id, tablet.device.id], 'both are listed')
  eq(pairedDevice(phone.value, now + 2000)?.id, phone.device.id, 'a cookie finds its device')
  const sealed = readFileSync(devicesPath(), 'utf8')
  check(!sealed.includes('My phone') && !sealed.includes(phone.device.id), 'the list on disk shows no names or ids (encrypted)')
  check(removeDevice(phone.device.id, now + 2000), 'one device is removed')
  check(!verifyDevice(phone.value, now + 2000), 'its cookie no longer verifies')
  check(verifyDevice(tablet.value, now + 2000), 'the other device is still paired')
  check(!removeDevice(phone.device.id, now + 2000), 'removing it again finds nothing')
  eq(listDevices(tablet.device.expiresAt).length, 0, 'an expired device drops off the list')
  writeFileSync(devicesPath(), sealed.replace(/"data":"(.)/, (_m, c: string) => `"data":"${c === 'A' ? 'B' : 'A'}`))
  check(!verifyDevice(tablet.value, now + 2000), 'a list tampered with pairs nobody')
  forgetAllDevices()

  // ── The key from LATENTRY_PAIRING_KEY (a keychain), never on disk ──
  const keyless = mkdtempSync(path.join(tmpdir(), 'latentry-pairing-env-'))
  const envKey = { LATENTRY_SETTINGS_FILE: path.join(keyless, 'settings.json'), LATENTRY_PAIRING_KEY: 'ab'.repeat(32) }
  const fromKeychain = issueDevice(now, envKey, 'Keychain')
  check(verifyDevice(fromKeychain.value, now, envKey), 'a device paired with the key from the environment verifies')
  check(!existsSync(keyPath(envKey)), 'and no key file is written')
  check(!verifyDevice(fromKeychain.value, now, { ...envKey, LATENTRY_PAIRING_KEY: 'cd'.repeat(32) }), 'another key in the environment pairs nobody')
  forgetAllDevices(envKey)
  check(!verifyDevice(fromKeychain.value, now, envKey) && !existsSync(keyPath(envKey)), 'forgetting every device empties the list, still without a key file')
  check(!verifyDevice(fromKeychain.value, now, { ...envKey, LATENTRY_PAIRING_KEY: 'not-hex' }), 'a malformed key pairs nobody (and throws nothing)')
  eq(engineEnv({ LATENTRY_PAIRING_KEY: 'ab'.repeat(32), PATH: 'x' } as unknown as NodeJS.ProcessEnv).LATENTRY_PAIRING_KEY, undefined, 'the engine is not given the key')
  rmSync(keyless, { recursive: true, force: true })

  // ── Codes ──
  check(!redeemCode('ABCDEFGH', now), 'no code yet: nothing pairs')
  const { code, expiresAt } = createCode(now)
  check(/^[A-HJKMNP-Z2-9]{8}$/.test(code), `8 characters without look-alikes (${code})`)
  eq(expiresAt, now + CODE_MS, 'good for 10 minutes')
  eq(currentCode(now)?.code, code, 'the Settings page can show it again')
  eq(normalizeCode(' abcd-efgh '), 'ABCDEFGH', 'typed with a dash, spaces or lower case is the same code')
  check(redeemCode(`${code.slice(0, 4).toLowerCase()}-${code.slice(4)}`, now + 1000), 'the code pairs once')
  check(!redeemCode(code, now + 2000), 'and only once')

  const late = createCode(now).code
  check(!redeemCode(late, now + CODE_MS), 'not after 10 minutes')
  check(currentCode(now + CODE_MS) === null, 'an expired code is not shown')

  const guessed = createCode(now).code
  for (let i = 0; i < CODE_TRIES - 1; i++) redeemCode('WRONGWRG', now)
  check(currentCode(now) !== null, `${CODE_TRIES - 1} wrong tries leave the code`)
  redeemCode('WRONGWRG', now)
  check(!redeemCode(guessed, now), `after ${CODE_TRIES} wrong tries the right code no longer works`)

  createCode(now)
  forgetAllDevices()
  check(currentCode(now) === null, 'forgetting every device also drops a waiting code')

  // ── Cookies and paths ──
  eq(deviceCookie(new Headers({ cookie: `a=1; ${DEVICE_COOKIE}=v1.x.1.y; b=2` })), 'v1.x.1.y', 'the device cookie is read from the Cookie header')
  check(isPairingPath('/pair') && isPairingPath('/api/pair') && isPairingPath('/_next/static/x.js'), 'the pairing page, its API and Next\'s files are open')
  check(!isPairingPath('/api/pairing') && !isPairingPath('/api/settings/pairing') && !isPairingPath('/'), 'nothing else is')
  check(pairingEnabled({}) && !pairingEnabled({ LATENTRY_PAIRING: 'off' }), 'on unless LATENTRY_PAIRING=off')

  // ── proxy.ts ──
  installPeerStamp()
  const peer = peerHeaderName()!
  const lan = (pathname: string, extra: Record<string, string> = {}) =>
    proxy(new NextRequest(`http://192.168.1.20:3000${pathname}`, { headers: { host: '192.168.1.20:3000', [peer]: '192.168.1.30', 'sec-fetch-site': 'same-origin', ...extra } }))
  const here = (pathname: string) =>
    proxy(new NextRequest(`http://localhost:3000${pathname}`, { headers: { host: 'localhost:3000', [peer]: '127.0.0.1', 'sec-fetch-site': 'same-origin' } }))

  const api = lan('/api/gen/backends')
  eq(api.status, 401, 'G1: an API call from an unpaired LAN device is refused')
  eq((await api.json()).pairing, true, 'and says pairing is what it needs')
  eq(lan('/api/gallery/0/a.png').status, 401, 'G1: so are gallery pictures')
  eq(lan('/api/gallery/0/a.png/tags', { 'content-type': 'application/json' }).status, 401, 'G1: and tag writes')
  const page = lan('/gallery')
  check(page.status === 307 || page.status === 308, `an unpaired page load is redirected (${page.status})`)
  eq(new URL(page.headers.get('location')!).pathname, '/pair', 'to the pairing page')
  eq(lan('/pair').headers.get('x-middleware-next'), '1', 'the pairing page itself is served')
  eq(lan('/api/pair').headers.get('x-middleware-next'), '1', 'and its API')
  eq(here('/api/gen/backends').headers.get('x-middleware-next'), '1', 'this machine needs no pairing')
  const paired = issueDevice()
  eq(lan('/api/gen/backends', { cookie: `${DEVICE_COOKIE}=${paired.value}` }).headers.get('x-middleware-next'), '1', 'a paired device is let through')
  eq(lan('/api/gen/backends', { cookie: `${DEVICE_COOKIE}=${paired.value}x` }).status, 401, 'a tampered cookie is not')
  eq(proxy(new NextRequest('http://192.168.1.20:3000/api/gen/backends', { headers: { host: 'localhost', 'x-forwarded-for': '127.0.0.1', [peer]: '192.168.1.30', 'sec-fetch-site': 'same-origin' } })).status, 401, 'forged local headers do not make a LAN device local')
  process.env.LATENTRY_PAIRING = 'off'
  eq(lan('/api/gen/backends').headers.get('x-middleware-next'), '1', 'LATENTRY_PAIRING=off lets everyone through')
  delete process.env.LATENTRY_PAIRING

  // ── /api/pair and /api/settings/pairing ──
  forgetAllDevices()
  const fromHere = { host: 'localhost:3000', 'content-type': 'application/json', [peer]: '127.0.0.1' }
  const fromLan = { host: '192.168.1.20:3000', 'content-type': 'application/json', [peer]: '192.168.1.31' }
  const post = (url: string, headers: Record<string, string>, body: unknown) =>
    new Request(url, { method: 'POST', headers, body: JSON.stringify(body) })
  eq((await pairingSettings(new Request('http://192.168.1.20:3000/api/settings/pairing', { headers: fromLan }))).status, 403, 'a LAN device cannot see the code')
  eq((await pairingAction(post('http://192.168.1.20:3000/api/settings/pairing', fromLan, { action: 'code' }))).status, 403, 'nor make one')
  eq((await pairingAction(post('http://192.168.1.20:3000/api/settings/pairing', fromLan, { action: 'forget' }))).status, 403, 'nor forget the devices')
  const made = await (await pairingAction(post('http://localhost:3000/api/settings/pairing', fromHere, { action: 'code' }))).json()
  check(typeof made.code?.code === 'string', 'this machine makes a code')
  const wrong = await pairRoute(post('http://192.168.1.20:3000/api/pair', fromLan, { code: 'WRONGWRG' }))
  eq(wrong.status, 403, 'a wrong code pairs nothing')
  check(!wrong.headers.get('set-cookie'), 'and sets no cookie')
  const right = await pairRoute(post('http://192.168.1.20:3000/api/pair', fromLan, { code: made.code.code }))
  eq(right.status, 200, 'the right code pairs')
  const cookie = right.headers.get('set-cookie') ?? ''
  check(cookie.startsWith(`${DEVICE_COOKIE}=`), 'with the device cookie')
  check(/HttpOnly/i.test(cookie) && /SameSite=Strict/i.test(cookie) && /Path=\//.test(cookie) && /Max-Age=2592000/.test(cookie), `HttpOnly, SameSite=Strict, 30 days (${cookie.replace(/=v1\.[^;]+/, '=…')})`)
  const cookieValue = cookie.split(';')[0].slice(DEVICE_COOKIE.length + 1)
  check(verifyDevice(cookieValue), 'and it verifies')

  // The device's own view, the list on this machine, re-pairing and unpairing.
  const withCookie = (headers: Record<string, string>, value: string) => ({ ...headers, cookie: `${DEVICE_COOKIE}=${value}` })
  const mine = await (await thisDeviceRoute(new Request('http://192.168.1.20:3000/api/pair', { headers: withCookie(fromLan, cookieValue) }))).json()
  check(mine.paired === true && typeof mine.expiresAt === 'number' && !('id' in mine), 'a paired device sees when its pairing ends (not its id)')
  eq((await (await thisDeviceRoute(new Request('http://192.168.1.20:3000/api/pair', { headers: fromLan }))).json()).paired, false, 'an unpaired one is told so')
  eq((await (await thisDeviceRoute(new Request('http://localhost:3000/api/pair', { headers: fromHere }))).json()).local, true, 'this machine is told it needs none')
  const listed = await (await pairingSettings(new Request('http://localhost:3000/api/settings/pairing', { headers: fromHere }))).json()
  eq(listed.devices.length, 1, 'this machine sees the paired device')
  const again = await (await pairingAction(post('http://localhost:3000/api/settings/pairing', fromHere, { action: 'code' }))).json()
  const repaired = await pairRoute(post('http://192.168.1.20:3000/api/pair', withCookie({ ...fromLan, [peer]: '192.168.1.33' }, cookieValue), { code: again.code.code, name: 'Renamed' }))
  eq(repaired.status, 200, 'a paired device can pair again')
  const after = await (await pairingSettings(new Request('http://localhost:3000/api/settings/pairing', { headers: fromHere }))).json()
  eq(after.devices.map((d: { name: string }) => d.name), ['Renamed'], 'pairing again replaces its entry instead of adding one')
  check(!verifyDevice(cookieValue), 'and its old cookie stops working')
  const newValue = (repaired.headers.get('set-cookie') ?? '').split(';')[0].slice(DEVICE_COOKIE.length + 1)
  eq((await pairingAction(post('http://localhost:3000/api/settings/pairing', fromHere, { action: 'remove', id: 'nope' }))).status, 404, 'removing an unknown device is a 404')
  const unpaired = await unpairRoute(new Request('http://192.168.1.20:3000/api/pair', { method: 'DELETE', headers: withCookie(fromLan, newValue) }))
  check(/Max-Age=0/.test(unpaired.headers.get('set-cookie') ?? ''), 'a device can unpair itself, and its cookie is cleared')
  check(!verifyDevice(newValue), 'after which it no longer verifies')
  eq(listDevices().length, 0, 'and it is off the list')
  let limited = 0
  for (let i = 0; i < 6; i++) {
    if ((await pairRoute(post('http://192.168.1.20:3000/api/pair', { ...fromLan, [peer]: '192.168.1.32' }, { code: 'WRONGWRG' }))).status === 429) limited++
  }
  check(limited >= 1, 'more than 5 tries a minute from one device are refused')
}

main()
  .catch((error: unknown) => check(false, `pairing checks threw: ${error instanceof Error ? error.stack : String(error)}`))
  .finally(() => {
    rmSync(scratch, { recursive: true, force: true })
    done('pairing')
  })
