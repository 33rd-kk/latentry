import { jsonError, json, readJson } from '@/lib/api'
import { getGalleryDirs } from '@/lib/gallery/dirs'
import { isOpenAction, openPicture } from '@/lib/gallery/reveal'
import { isFromThisMachine } from '@/lib/settings/access'

export const runtime = 'nodejs'

/**
 * Shows a picture in this machine's file manager (`reveal`) or its default
 * picture app (`open`). Only from this machine: from a phone it would act on
 * someone else's screen. Read-only folders too, since nothing is written.
 *
 *   POST { action: 'reveal' | 'open' }
 */
export async function POST(request: Request, ctx: RouteContext<'/api/gallery/[dir]/[name]/open'>) {
  if (!isFromThisMachine(request.headers)) return jsonError('Only from this computer', 403)
  const { dir: dirParam, name } = await ctx.params
  const dir = /^\d+$/.test(dirParam) ? getGalleryDirs()[Number(dirParam)] : undefined
  if (!dir) return jsonError('Not found', 404)

  const body = await readJson(request)
  if (!isOpenAction(body?.action)) return jsonError('action must be reveal or open', 400)
  try {
    return (await openPicture(dir, name, body.action)) ? json({ ok: true }) : jsonError('Not found', 404)
  } catch (error) {
    console.error('Opening a picture failed:', error)
    return jsonError('Could not open it', 500)
  }
}
