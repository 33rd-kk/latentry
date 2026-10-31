import { jsonError, json, readJson } from '@/lib/api'
import { HfLookupError, resolveHfFile } from '@/lib/engine/hf-resolve'
import { parseHfFileUrl } from '@/lib/engine/hf-url'
import { serverMessage } from '@/lib/i18n/core'
import { editRefusal } from '@/lib/settings/access'

export const runtime = 'nodejs'

/**
 * Looks up a Hugging Face file URL before it is downloaded: { url } → the
 * commit, size, SHA-256 and license tag, for the page to show. Nothing is
 * downloaded and nothing is kept; the URL is not logged. Like downloading,
 * only from this computer or an owner device.
 */
export async function POST(request: Request) {
  if (editRefusal(request.headers)) return jsonError('Only from this computer', 403)
  const body = await readJson(request)
  const parsed = parseHfFileUrl(typeof body?.url === 'string' ? body.url : '')
  if (!parsed.ok) return jsonError(serverMessage(parsed.error), 400)
  try {
    const file = await resolveHfFile(parsed)
    return json({
      repo: file.repo,
      path: file.path,
      fileName: file.path.split('/').pop(),
      commit: file.commit,
      sha256: file.sha256,
      size: file.size,
      license: file.license,
      gated: file.gated,
      token: Boolean(process.env.HF_TOKEN),
    })
  } catch (error) {
    if (error instanceof HfLookupError) return jsonError(serverMessage(error.key), error.status)
    throw error
  }
}
