import { jsonError, json, readJson } from '@/lib/api'
import { getGalleryDirs } from '@/lib/gallery/dirs'
import { writeTags } from '@/lib/gallery/save'
import type { ImageTag } from '@/lib/gallery/png-meta'

export const runtime = 'nodejs'

const MAX_TAGS = 500

/**
 * Writes WD14 tags into a picture, so the gallery shows them next time without
 * asking the tagger again. Only the save folder is ever written.
 */
export async function POST(request: Request, ctx: RouteContext<'/api/gallery/[dir]/[name]/tags'>) {
  const { dir: dirParam, name } = await ctx.params
  const dir = /^\d+$/.test(dirParam) ? getGalleryDirs()[Number(dirParam)] : undefined
  if (!dir) return jsonError('Not found', 404)
  if (!dir.writable) return jsonError('This folder is read-only', 403)

  const body = await readJson(request)
  const raw = Array.isArray(body?.tags) ? body.tags : null
  if (!raw || raw.length > MAX_TAGS) return jsonError('tags must be a list', 400)
  const tags: ImageTag[] = []
  for (const tag of raw) {
    if (typeof tag?.name !== 'string' || typeof tag?.score !== 'number') return jsonError('Malformed tag', 400)
    tags.push({
      name: tag.name.slice(0, 200),
      score: Math.min(1, Math.max(0, tag.score)),
      category: typeof tag.category === 'number' ? tag.category : 0,
    })
  }

  try {
    const written = await writeTags(dir, name, tags)
    return written ? json({ ok: true }) : jsonError('Not found', 404)
  } catch (error) {
    console.error('Writing tags failed:', error)
    return jsonError('Could not write the file', 500)
  }
}
