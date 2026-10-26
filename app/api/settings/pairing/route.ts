import { jsonError, json, readJson } from '@/lib/api'
import { createCode, createOwnerCode, currentCode, DEVICE_DAYS, forgetAllDevices, listDevices, pairingEnabled, removeDevice } from '@/lib/security/pairing'
import { hasLocalToken } from '@/lib/security/local-token'
import { isLoopbackAddress } from '@/lib/security/loopback'
import { isFromThisMachine, mayAdminister } from '@/lib/settings/access'

export const runtime = 'nodejs'

/**
 * Pairing other devices, from this machine or an owner device only, whatever
 * SETTINGS_EDIT says: a code shown anywhere else could be read by the device
 * it is meant to keep out.
 *
 *   GET                                 { enabled, days, code: { code, expiresAt } | null, devices, network }
 *   POST { action: 'code' }             a new code (replacing any earlier one)
 *   POST { action: 'owner-code' }       a new owner code; from this machine only (scripts/owner-code.mjs),
 *                                       or a terminal in the container (lib/security/local-token.ts)
 *   POST { action: 'remove', id }       unpairs one device
 *   POST { action: 'forget' }           forgets every paired device
 */
export async function GET(request: Request) {
  if (!mayAdminister(request.headers)) return jsonError('Only from this computer or an owner device', 403)
  return json({ enabled: pairingEnabled(), days: DEVICE_DAYS, code: currentCode(), devices: listDevices(), network: listensOnNetwork() })
}

/** Whether other devices can reach this server: it listens beyond loopback (set by scripts/serve.mjs). */
function listensOnNetwork(env: NodeJS.ProcessEnv = process.env): boolean {
  const host = env.LATENTRY_LISTEN_HOST?.trim()
  return !!host && !isLoopbackAddress(host)
}

export async function POST(request: Request) {
  // A terminal in the container, where loopback is not trusted, may make an
  // owner code and forget the devices, the two things the scripts do.
  const terminal = hasLocalToken(request.headers)
  if (!mayAdminister(request.headers) && !terminal) return jsonError('Only from this computer or an owner device', 403)
  const body = await readJson(request)
  if (terminal && !mayAdminister(request.headers) && body?.action !== 'owner-code' && body?.action !== 'forget') {
    return jsonError('Only from this computer or an owner device', 403)
  }
  if (body?.action === 'code') return json({ code: createCode() })
  // Being able to run a command on this machine is what makes an owner, so an
  // owner device cannot make another owner from its browser.
  if (body?.action === 'owner-code') {
    if (!isFromThisMachine(request.headers) && !terminal) return jsonError('Only from this computer', 403)
    if (!pairingEnabled()) return jsonError('Pairing is off (LATENTRY_PAIRING=off)', 409)
    return json({ code: createOwnerCode() })
  }
  if (body?.action === 'remove' && typeof body.id === 'string') {
    return removeDevice(body.id) ? json({ devices: listDevices() }) : jsonError('No such device', 404)
  }
  if (body?.action === 'forget') {
    forgetAllDevices()
    return json({ devices: [] })
  }
  return jsonError('action must be code, owner-code, remove or forget', 400)
}
