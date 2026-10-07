/**
 * The /api guard (lib/security/route-guard.ts), the request budget
 * (lib/security/request-budget.ts) and the in-process locks they lean on
 * (lib/security/concurrency.ts).
 *
 * Run with: npm test -- security
 */
import { createServer, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { check, done, eq, knownGap } from './assert'
import { POST as testBackend } from '../app/api/settings/test/route'
import { editRefusal } from '../lib/settings/access'
import { activeRun, holders, setActiveRun, tryAcquire, tryEnter } from '../lib/security/concurrency'
import { checkApiRequest } from '../lib/security/route-guard'
import { checkRequestBudget, classifyRequest, clientIp, FixedWindow, sseSlot } from '../lib/security/request-budget'

// ── Locks and slots ──
const first = tryAcquire('lock:a')
check(first !== null, 'a free lock is taken')
check(tryAcquire('lock:a') === null, 'a held lock is refused')
first!()
first!()
const again = tryAcquire('lock:a')
check(again !== null, 'a released lock can be taken again (and a double release is harmless)')
const next = tryAcquire('lock:c')
again!()
next!()
const holder = tryAcquire('lock:d')!
holder()
const successor = tryAcquire('lock:d')!
holder()
check(tryAcquire('lock:d') === null, 'a stale release does not free the next holder')
successor()

const one = tryEnter('sem', 2)
const two = tryEnter('sem', 2)
check(one !== null && two !== null && tryEnter('sem', 2) === null, 'at most max holders')
one!()
one!()
eq(holders('sem'), 1, 'a double release counts once')
two!()
eq(holders('sem'), 0, 'all released')

let running = true
setActiveRun('run', 'job-1', () => running)
eq(activeRun('run'), 'job-1', 'an active run is reported')
running = false
eq(activeRun('run'), null, 'a finished run frees the slot by itself')

// ── Route guard ──
const guard = (method: string, headers: Record<string, string>, env: Record<string, string | undefined> = {}) =>
  checkApiRequest({ method, headers: new Headers(headers) }, env)
const same = { host: 'localhost:3000', 'sec-fetch-site': 'same-origin' }
check(guard('GET', same) === null, 'same-origin GET from localhost')
check(guard('POST', { ...same, 'content-type': 'application/json' }) === null, 'same-origin JSON POST')
check(guard('POST', same) === null, 'bodyless POST (cancel)')
check(guard('GET', { host: 'localhost:3000', 'sec-fetch-site': 'none' }) === null, 'typed into the address bar')
check(guard('GET', { host: '192.168.1.20:3000', 'sec-fetch-site': 'same-origin' }) === null, 'a phone on the LAN')
check(guard('GET', { host: '127.0.0.1:3000' }) === null, 'curl without browser headers')
check(guard('GET', { host: '[::1]:3000', 'sec-fetch-site': 'same-origin' }) === null, 'IPv6 loopback')
check(
  guard('POST', { host: 'localhost:3000', origin: 'http://localhost:3000', 'content-type': 'application/json' }) === null,
  'matching Origin without Sec-Fetch-Site'
)
eq(guard('POST', { host: 'localhost:3000', 'sec-fetch-site': 'cross-site', 'content-type': 'text/plain' })?.status, 403, 'cross-site simple POST')
eq(guard('GET', { host: 'localhost:3000', 'sec-fetch-site': 'cross-site' })?.status, 403, 'cross-site GET (an <img> of a gallery picture)')
eq(guard('GET', { host: 'localhost:3000', 'sec-fetch-site': 'same-site' })?.status, 403, 'same-site, other port')
eq(guard('POST', { host: 'localhost:3000', origin: 'https://evil.example' })?.status, 403, 'foreign Origin')
eq(guard('POST', { host: 'localhost:3000', origin: 'null' })?.status, 403, 'opaque Origin')
eq(guard('POST', { ...same, 'content-type': 'text/plain;charset=UTF-8' })?.status, 415, 'non-JSON body even same-origin')
eq(guard('GET', { host: 'rebind.attacker.example:3000', 'sec-fetch-site': 'same-origin' })?.status, 403, 'rebound hostname')
eq(guard('GET', { host: '8.8.8.8:3000', 'sec-fetch-site': 'same-origin' })?.status, 403, 'public IP')
eq(guard('GET', { host: '172.32.0.1', 'sec-fetch-site': 'same-origin' })?.status, 403, '172.32/16 is not private')
check(
  guard('GET', { host: 'mybox.local:3000', 'sec-fetch-site': 'same-origin' }, { ALLOWED_HOSTS: 'MyBox.local, other' }) === null,
  'ALLOWED_HOSTS opt-in, case-insensitive'
)

// ── Budget classes ──
eq(classifyRequest('/', 'GET'), 'page', 'a page load')
eq(classifyRequest('/gallery', 'GET'), 'page', 'another page')
eq(classifyRequest('/api/gen/backends', 'GET'), 'api', 'an API read')
eq(classifyRequest('/api/gen/anima/generate', 'POST'), 'post', 'a POST')
eq(classifyRequest('/api/gen/anima/job/stream', 'GET'), null, 'streams are capped by connection instead')
eq(classifyRequest('/api/gallery/0/a.png', 'GET'), null, 'gallery bytes are not counted')
eq(classifyRequest('/api/gallery', 'GET'), 'api', 'the gallery list is')
eq(classifyRequest('/api/gallery/0/a.png/tags', 'POST'), 'post', 'tag writes are')
eq(classifyRequest('/_next/webpack-hmr', 'GET'), null, 'dev internals')
eq(classifyRequest('/api/gen/backends', 'OPTIONS'), null, 'preflights')

eq(clientIp(new Headers({ 'x-forwarded-for': '10.0.0.5, 1.2.3.4' })), '10.0.0.5', 'first forwarded hop')
eq(clientIp(new Headers({ 'x-real-ip': '10.0.0.6' })), '10.0.0.6', 'x-real-ip fallback')
eq(clientIp(new Headers()), '127.0.0.1', 'no headers means loopback')

// ── Windows ──
const window = new FixedWindow(2, 1000)
check(window.take('ip', 0).ok && window.take('ip', 10).ok, 'two fit')
const refused = window.take('ip', 20)
check(!refused.ok && refused.reopensAt === 1000, 'the third waits for the window to reopen')
check(window.take('other', 20).ok, 'windows are per key')
check(window.take('ip', 1000).ok, 'a new window opens on time')

const env = { REQUEST_BUDGET_POST_PER_MIN: '2' }
const post = (ip: string) =>
  checkRequestBudget({ method: 'POST', pathname: '/api/gen/x/generate', headers: new Headers({ 'x-forwarded-for': ip }) }, env)
check(post('10.9.9.1') === null && post('10.9.9.1') === null, 'POSTs under the budget')
const over = post('10.9.9.1')
check(over?.kind === 'post' && over.scope === 'ip' && over.retryAfter >= 1, 'the next POST from that IP is refused')
check(post('10.9.9.2') === null, 'another IP has its own budget')
check(checkRequestBudget({ method: 'POST', pathname: '/api/x', headers: new Headers() }, { ...env, REQUEST_BUDGET: 'off' }) === null, 'REQUEST_BUDGET=off')

const slots = [sseSlot(new Headers({ 'x-forwarded-for': '10.8.8.8' }), { REQUEST_BUDGET_SSE_PER_IP: '1' })]
check(slots[0] !== null, 'a stream slot')
check(sseSlot(new Headers({ 'x-forwarded-for': '10.8.8.8' }), { REQUEST_BUDGET_SSE_PER_IP: '1' }) === null, 'over the per-IP stream cap')
slots[0]!()

// ── Privacy audit (2026-10), see audit/2026-10-privacy-audit.md (local, not committed) ──

// F3: "local" settings edits go by headers a program on the LAN can write.
eq(editRefusal(new Headers({ host: '192.168.1.20:3000', 'x-forwarded-for': '192.168.1.30' }), {}), 'notLocal', 'a LAN client may not edit settings by default')
knownGap(
  editRefusal(new Headers({ host: 'localhost', 'x-forwarded-for': '127.0.0.1' }), {}) !== null,
  'F3',
  'a LAN program that sends Host: localhost and X-Forwarded-For: 127.0.0.1 passes as this machine'
)

// F1: "test this backend" may use a saved token only on that backend's own server.
async function tokenLending(): Promise<void> {
  const seen: IncomingHttpHeaders[] = []
  const server = createServer((request, response) => {
    seen.push(request.headers)
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end('{}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  // One listener, two origins: the backend is 127.0.0.1, "elsewhere" is localhost.
  const home = `http://127.0.0.1:${port}/`
  const elsewhere = `http://localhost:${port}/`
  // Only this script's backends: no settings file, one backend in the environment.
  Object.assign(process.env, {
    LATENTRY_SETTINGS_FILE: path.join(tmpdir(), `latentry-audit-${process.pid}-none.json`),
    GEN_BACKENDS: `victim|diffusers|${home}|generic`,
    GEN_TOKEN_VICTIM: 'victim-secret-token',
  })
  delete process.env.SETTINGS_EDIT
  try {
    const ask = (body: Record<string, unknown>) =>
      testBackend(
        new Request('http://localhost:3000/api/settings/test', {
          method: 'POST',
          headers: { host: 'localhost:3000', 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
      )
    const leaked = (expected: string) => seen.some((headers) => (headers.authorization ?? '').includes(expected))

    eq((await ask({ kind: 'diffusers', url: elsewhere, token: 'typed-token' })).status, 200, 'a backend can be tried before it is saved')
    check(leaked('typed-token'), 'a token typed into the form is sent with the try')

    seen.length = 0
    await ask({ kind: 'diffusers', url: home, id: 'victim' })
    check(leaked('victim-secret-token'), 'trying a saved backend at its own address uses its token')

    seen.length = 0
    await ask({ kind: 'diffusers', url: elsewhere, id: 'victim' })
    check(seen.length > 0 && !leaked('victim-secret-token'), 'F1: naming a saved backend id does not send its Bearer token to another server')

    seen.length = 0
    await ask({ kind: 'a1111', url: elsewhere, id: 'victim' })
    check(seen.length > 0 && !seen.some((headers) => headers.authorization), 'F1: nor as Basic auth with kind a1111')

    seen.length = 0
    process.env.SETTINGS_EDIT = 'off'
    eq((await ask({ kind: 'diffusers', url: elsewhere, id: 'victim' })).status, 403, 'SETTINGS_EDIT=off closes the route')
    check(seen.length === 0, 'and nothing is sent')
  } finally {
    delete process.env.SETTINGS_EDIT
    server.close()
  }
}

tokenLending().then(
  () => done('security'),
  (error: unknown) => {
    check(false, `token lending check threw: ${error instanceof Error ? error.stack : String(error)}`)
    done('security')
  }
)
