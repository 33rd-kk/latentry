import { jsonError, json, readJson } from '@/lib/api'
import { createCode, currentCode, DEVICE_DAYS, forgetAllDevices, listDevices, pairingEnabled, removeDevice } from '@/lib/security/pairing'
import { isFromThisMachine } from '@/lib/settings/access'

export const runtime = 'nodejs'

/**
 * Pairing other devices, from this machine only, whatever SETTINGS_EDIT says:
 * a code shown anywhere else could be read by the device it is meant to keep out.
 *
 *   GET                                 { enabled, days, code: { code, expiresAt } | null, devices }
 *   POST { action: 'code' }             a new code (replacing any earlier one)
 *   POST { action: 'remove', id }       unpairs one device
 *   POST { action: 'forget' }           forgets every paired device
 */
export async function GET(request: Request) {
  if (!isFromThisMachine(request.headers)) return jsonError('Only from this computer', 403)
  return json({ enabled: pairingEnabled(), days: DEVICE_DAYS, code: currentCode(), devices: listDevices() })
}

export async function POST(request: Request) {
  if (!isFromThisMachine(request.headers)) return jsonError('Only from this computer', 403)
  const body = await readJson(request)
  if (body?.action === 'code') return json({ code: createCode() })
  if (body?.action === 'remove' && typeof body.id === 'string') {
    return removeDevice(body.id) ? json({ devices: listDevices() }) : jsonError('No such device', 404)
  }
  if (body?.action === 'forget') {
    forgetAllDevices()
    return json({ devices: [] })
  }
  return jsonError('action must be code, remove or forget', 400)
}
