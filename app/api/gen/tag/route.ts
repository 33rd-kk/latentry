import { jsonError, json, readJson } from '@/lib/api'
import { getTagger } from '@/lib/tagger'

export const runtime = 'nodejs'

/** WD14 tags for a picture, from the built-in model or a backend (see lib/tagger). */
export async function POST(request: Request) {
  const body = await readJson(request)
  if (typeof body?.image_base64 !== 'string' || !body.image_base64) return jsonError('image_base64 is required', 400)
  const tagger = await getTagger()
  if (!tagger) return jsonError('Nothing can tag pictures: set a WD14 model folder in Settings, or a backend with a tagger', 503)
  const result = await tagger.tag(body.image_base64)
  return result.ok ? json(result.value) : jsonError(result.error, result.status)
}
