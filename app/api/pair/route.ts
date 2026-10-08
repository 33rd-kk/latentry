import { NextResponse } from 'next/server'
import { jsonError, json, readJson } from '@/lib/api'
import { serverMessage } from '@/lib/i18n/core'
import { cleanName, DEVICE_COOKIE, deviceCookie, issueDevice, pairedDevice, redeemCode, removeDevice } from '@/lib/security/pairing'
import { clientIp, FixedWindow } from '@/lib/security/request-budget'
import { isFromThisMachine } from '@/lib/settings/access'

export const runtime = 'nodejs'

// Far below the general POST budget: each try is a guess at the code.
const globalForPair = globalThis as typeof globalThis & { __pairTries?: FixedWindow }
const tries = (globalForPair.__pairTries ??= new FixedWindow(5))

/**
 * This device's pairing (see lib/security/pairing.ts). Open to devices that
 * are not paired yet (proxy.ts lets /api/pair through), so each handler
 * checks the cookie itself.
 *
 *   GET                             { local: true } | { paired: false } | { paired: true, name, number, pairedAt, expiresAt }
 *   POST   { code, name? }          pairs it: the code shown on the computer running Latentry in, a device cookie out
 *   DELETE                          unpairs it
 */
export async function GET(request: Request) {
  if (isFromThisMachine(request.headers)) return json({ local: true })
  const device = pairedDevice(deviceCookie(request.headers))
  if (!device) return json({ paired: false })
  const { name, number, pairedAt, expiresAt } = device
  return json({ paired: true, name, number, pairedAt, expiresAt })
}

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

  // Pairing again (before the old pairing ends) replaces this device's entry
  // rather than adding a second one, keeping its name unless a new one is given.
  const previous = pairedDevice(deviceCookie(request.headers))
  const issued = issueDevice(Date.now(), process.env, cleanName(body.name) ?? previous?.name ?? null)
  if (previous) removeDevice(previous.id)
  const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  response.cookies.set(DEVICE_COOKIE, issued.value, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    maxAge: issued.maxAgeSeconds,
  })
  return response
}

export async function DELETE(request: Request) {
  const device = pairedDevice(deviceCookie(request.headers))
  if (device) removeDevice(device.id)
  const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  response.cookies.set(DEVICE_COOKIE, '', { httpOnly: true, sameSite: 'strict', path: '/', maxAge: 0 })
  return response
}
