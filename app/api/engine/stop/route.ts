import { jsonError, json } from '@/lib/api'
import { stopEngines } from '@/lib/engine/supervisor'
import { editRefusal } from '@/lib/settings/access'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  if (editRefusal(request.headers)) return jsonError('Only from this computer', 403)
  await stopEngines()
  return json({ status: 'stopped' })
}
