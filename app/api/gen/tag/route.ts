import { jsonError, json, readJson } from '@/lib/api'
import { getTaggerAdapter } from '@/lib/backends'

export const runtime = 'nodejs'

/** WD14 tags for a picture, from TAGGER_BACKEND or the first backend that can tag. */
export async function POST(request: Request) {
  const body = await readJson(request)
  if (typeof body?.image_base64 !== 'string' || !body.image_base64) return jsonError('image_base64 is required', 400)
  const tagger = await getTaggerAdapter()
  if (!tagger?.tag) return jsonError('No backend can tag pictures', 503)
  const result = await tagger.tag(body.image_base64)
  return result.ok ? json(result.value) : jsonError(result.error, result.status)
}
