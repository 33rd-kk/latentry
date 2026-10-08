import { NextResponse } from 'next/server'
import { jsonError, readJson } from '@/lib/api'
import { serverMessage } from '@/lib/i18n/core'
import { DEVICE_COOKIE, issueDevice, redeemCode } from '@/lib/security/pairing'
import { clientIp, FixedWindow } from '@/lib/security/request-budget'

export const runtime = 'nodejs'

// Far below the general POST budget: each try is a guess at the code.
const globalForPair = globalThis as typeof globalThis & { __pairTries?: FixedWindow }
const tries = (globalForPair.__pairTries ??= new FixedWindow(5))

/**
 * Pairs this device: the code shown on the computer running Latentry in,
 * a device cookie out (see lib/security/pairing.ts).
 *
 *   POST { code: string }
 */
export async function POST(request: Request) {
  const allowed = tries.take(clientIp(request.headers), Date.now())
  if (!allowed.ok) {
    const seconds = Math.max(1, Math.ceil((allowed.reopensAt - Date.now()) / 1000))
    return jsonError(serverMessage('system.tooManyRequests', { seconds }), 429)
  }

  const body = await readJson(request)
  if (typeof body?.code !== 'string' || !redeemCode(body.code)) {
    return jsonError(serverMessage('pair.wrongCode'), 403)
  }

  const device = issueDevice()
  const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  response.cookies.set(DEVICE_COOKIE, device.value, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    maxAge: device.maxAgeSeconds,
  })
  return response
}
