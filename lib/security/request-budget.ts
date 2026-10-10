// Per-IP request budget, applied in proxy.ts.
//
// There is no login, so the only handle on "who" is the client IP. This is a
// coarse outer fence against a flood -- a reload held down, a runaway script, a
// reconnect loop -- counted per request class, each with its own window:
//   page    a page load
//   api     a GET (or other non-POST) to /api/*
//   post    a POST to /api/*, which drives a backend's GPU or writes a file
// plus one window across every IP for pages and APIs together, so a single
// device running away cannot slow everyone else down.
//
// Left alone: Next's own internals, SSE streams (capped per connection
// instead, see sseSlot) and gallery image bytes, which a scrolling gallery
// legitimately asks for by the hundred.
//
// The IP is the address the connection really came from (lib/security/peer.ts).
// x-forwarded-for is a header any client can write, so it is believed only
// from a connection on this machine -- a reverse proxy here, which says who
// it is forwarding for. Elsewhere a forged one changes nothing.
//
// REQUEST_BUDGET=off turns it off.

import { tryEnter, type Release } from '@/lib/security/concurrency'
import { isLoopbackAddress, peerAddress } from '@/lib/security/peer'

type Env = Record<string, string | undefined>

export type BudgetClass = 'page' | 'api' | 'post'

export const BUDGET_DEFAULTS = {
  /** Page loads per IP per minute (REQUEST_BUDGET_PAGE_PER_MIN). */
  page: 120,
  /** Non-POST /api calls per IP per minute (REQUEST_BUDGET_API_PER_MIN). */
  api: 300,
  /** POSTs per IP per minute (REQUEST_BUDGET_POST_PER_MIN). */
  post: 30,
  /** Pages and APIs from every IP together per minute (REQUEST_BUDGET_GLOBAL_PER_MIN). */
  global: 1200,
  /** Open SSE connections per IP (REQUEST_BUDGET_SSE_PER_IP). */
  ssePerIp: 12,
} as const

const WINDOW_MS = 60 * 1000
// Far more addresses than a home network has in a minute.
const MAX_KEYS = 10_000

/**
 * Who sent this request. The connection's own address when it comes from
 * another machine; from this machine (a reverse proxy, or no stamp at all in
 * the verify scripts) the first hop of x-forwarded-for, else x-real-ip.
 */
export function clientIp(headers: Headers): string {
  const peer = peerAddress(headers)
  if (peer && !isLoopbackAddress(peer)) return peer.replace(/^::ffff:/i, '')
  const forwarded = headers.get('x-forwarded-for')
  const first = forwarded?.split(',')[0]?.trim()
  if (first) return first
  return headers.get('x-real-ip')?.trim() || '127.0.0.1'
}

export function isBudgetEnabled(env: Env): boolean {
  return env.REQUEST_BUDGET?.trim().toLowerCase() !== 'off'
}

// Gallery image bytes: /api/gallery/<dir>/<name>, not the list or the tag writes.
const GALLERY_BYTES = /^\/api\/gallery\/\d+\/[^/]+$/

/**
 * Which window a request is counted in, or null for one that is not counted.
 * Pure, so the verify script can pin the edges down.
 */
export function classifyRequest(pathname: string, method: string): BudgetClass | null {
  const verb = method.toUpperCase()
  if (verb === 'OPTIONS') return null
  // Dev server internals (HMR socket, overlay stack frames).
  if (pathname.startsWith('/_next/') || pathname.startsWith('/__nextjs')) return null

  if (pathname.startsWith('/api/')) {
    if (verb === 'POST') return 'post'
    // Held open for minutes; capped by concurrent connections instead.
    if (/\/stream(\/|$)/.test(pathname)) return null
    if (verb === 'GET' && GALLERY_BYTES.test(pathname)) return null
    return 'api'
  }

  // Router prefetches land here too: Next strips the prefetch headers before
  // the proxy sees the request, so they cannot be told apart. The page budget
  // is sized with that in mind.
  return 'page'
}

/**
 * A fixed one-minute window per key: the first request opens it, and it
 * admits `max` requests until it closes. Coarse, and cheap enough to run on
 * every request.
 */
export class FixedWindow {
  private readonly windows = new Map<string, { opened: number; used: number }>()
  private lastSweep: number | null = null

  /**
   * @param maxKeys How many keys (IPs) it tracks at once. A key it has no room
   *   for is refused until old windows close, so a flood of new addresses is
   *   held to a bounded map instead of growing it.
   */
  constructor(
    readonly max: number,
    readonly windowMs: number = WINDOW_MS,
    readonly maxKeys: number = MAX_KEYS
  ) {}

  /** Counts one request; returns the epoch ms the window reopens if it is refused. */
  take(key: string, now = Date.now()): { ok: true } | { ok: false; reopensAt: number } {
    if (this.lastSweep === null || now - this.lastSweep >= this.windowMs) {
      this.lastSweep = now
      this.sweep(now)
    }
    const window = this.windows.get(key)
    if (!window || now - window.opened >= this.windowMs) {
      if (!window && this.windows.size >= this.maxKeys) {
        this.sweep(now, 1)
        if (this.windows.size >= this.maxKeys) return { ok: false, reopensAt: now + this.windowMs }
      }
      this.windows.set(key, { opened: now, used: 1 })
      return { ok: true }
    }
    window.used += 1
    return window.used <= this.max ? { ok: true } : { ok: false, reopensAt: window.opened + this.windowMs }
  }

  /** Drops windows closed for `windows` window lengths; take() runs it once a window. */
  sweep(now = Date.now(), windows = 2): void {
    for (const [key, window] of this.windows) {
      if (now - window.opened >= this.windowMs * windows) this.windows.delete(key)
    }
  }

  /** How many keys it is tracking. For tests. */
  get size(): number {
    return this.windows.size
  }
}

function envInt(env: Env, name: string, fallback: number): number {
  const value = Number(env[name])
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback
}

interface Windows {
  page: FixedWindow
  api: FixedWindow
  post: FixedWindow
  global: FixedWindow
  /** The limits these were built with, so a changed env rebuilds them. */
  signature: string
}

// On globalThis so a hot reload of proxy.ts does not hand everyone a fresh window.
const globalForBudget = globalThis as typeof globalThis & { __requestBudget?: Windows }

function windowsFor(env: Env): Windows {
  const limits = {
    page: envInt(env, 'REQUEST_BUDGET_PAGE_PER_MIN', BUDGET_DEFAULTS.page),
    api: envInt(env, 'REQUEST_BUDGET_API_PER_MIN', BUDGET_DEFAULTS.api),
    post: envInt(env, 'REQUEST_BUDGET_POST_PER_MIN', BUDGET_DEFAULTS.post),
    global: envInt(env, 'REQUEST_BUDGET_GLOBAL_PER_MIN', BUDGET_DEFAULTS.global),
  }
  const signature = [limits.page, limits.api, limits.post, limits.global].join(':')
  const existing = globalForBudget.__requestBudget
  if (existing && existing.signature === signature) return existing

  const created: Windows = {
    page: new FixedWindow(limits.page),
    api: new FixedWindow(limits.api),
    post: new FixedWindow(limits.post),
    global: new FixedWindow(limits.global),
    signature,
  }
  globalForBudget.__requestBudget = created
  return created
}

export interface BudgetRejection {
  kind: BudgetClass
  /** Whole seconds until the window that refused this reopens. */
  retryAfter: number
  /** Whether it was this IP's own window or the all-IP one. */
  scope: 'ip' | 'global'
}

/** Counts one request against its budget and says why it must be refused, or null to let it through. */
export function checkRequestBudget(
  request: { method: string; headers: Headers; pathname: string },
  env: Env
): BudgetRejection | null {
  if (!isBudgetEnabled(env)) return null
  const kind = classifyRequest(request.pathname, request.method)
  if (!kind) return null

  const windows = windowsFor(env)
  const now = Date.now()

  const seconds = (reopensAt: number) => Math.max(1, Math.ceil((reopensAt - now) / 1000))
  const own = windows[kind].take(clientIp(request.headers), now)
  if (!own.ok) return { kind, retryAfter: seconds(own.reopensAt), scope: 'ip' }

  // POSTs are already few per IP, and each backend has its own one-at-a-time
  // lock; the all-IP window is for pages and APIs.
  if (kind !== 'post') {
    const all = windows.global.take('all', now)
    if (!all.ok) return { kind, retryAfter: seconds(all.reopensAt), scope: 'global' }
  }
  return null
}

/**
 * A slot for one open SSE connection from this client, or null when it already
 * has as many open as it may.
 */
export function sseSlot(headers: Headers, env: Env): Release | null {
  if (!isBudgetEnabled(env)) return () => {}
  const max = envInt(env, 'REQUEST_BUDGET_SSE_PER_IP', BUDGET_DEFAULTS.ssePerIp)
  return tryEnter(`sse:${clientIp(headers)}`, max)
}
