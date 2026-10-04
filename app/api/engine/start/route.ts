import { jsonError, json } from '@/lib/api'
import { startEngines } from '@/lib/engine/supervisor'
import { editRefusal } from '@/lib/settings/access'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  if (editRefusal(request.headers)) return jsonError('Only from this computer', 403)
  const result = await startEngines()
  if (!result.ok) {
    return jsonError(result.reason === 'notInstalled' ? 'The engine is not installed yet' : 'No GPU is selected for the engine', 409, {
      reason: result.reason,
    })
  }
  return json({ status: 'starting', engines: result.engines })
}
