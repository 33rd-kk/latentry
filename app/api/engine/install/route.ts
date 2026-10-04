import { jsonError, json } from '@/lib/api'
import { startInstall } from '@/lib/engine/install'
import { startEngines, stopEngines } from '@/lib/engine/supervisor'
import { editRefusal } from '@/lib/settings/access'

export const runtime = 'nodejs'

/**
 * Installs (or repairs) the engine in the background; GET /api/engine shows
 * its progress. Running engines are stopped first, since on Windows they hold
 * the files the install replaces, and started again when it is done.
 */
export async function POST(request: Request) {
  if (editRefusal(request.headers)) return jsonError('Only from this computer', 403)
  await stopEngines()
  if (!startInstall(() => void startEngines())) return jsonError('An install is already running', 409)
  return json({ status: 'installing' }, { status: 202 })
}
