import type { NextRequest } from 'next/server'
import { jsonError, json } from '@/lib/api'
import { getGalleryDirs } from '@/lib/gallery/dirs'
import { listModels, listPage } from '@/lib/gallery/fs'
import { fromParams } from '@/lib/gallery/filter'

export const runtime = 'nodejs'

const MAX_LIMIT = 200

/**
 * Without `dir`: the folders (by index and name, never their paths).
 * With `dir`: one page of that folder, in the order and with the filters
 * asked for (see lib/gallery/filter.ts), newest first by default.
 *
 *   ?dir=0&cursor=<from the last page>&limit=60&q=words&sort=name-asc&orientation=portrait…
 *
 * The orders by date made and by pixel count need the whole folder read
 * first; until it is, the reply carries `indexing: { done, total }` and no
 * items, and the page asks again.
 *
 * With `dir` and `models=1`: every model named in that folder, for the model
 * filter, or the same `indexing` progress.
 */
export async function GET(request: NextRequest) {
  const dirs = getGalleryDirs()
  const params = request.nextUrl.searchParams
  const dirParam = params.get('dir')
  if (dirParam === null) {
    return json({ dirs: dirs.map(({ index, label, writable }) => ({ index, label, writable })) })
  }

  const dir = /^\d+$/.test(dirParam) ? dirs[Number(dirParam)] : undefined
  if (!dir) return jsonError('Unknown folder', 404)

  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(params.get('limit')) || 60))
  try {
    if (params.get('models') === '1') return json(await listModels(dir))
    const page = await listPage(dir, {
      cursor: params.get('cursor'),
      limit,
      filter: fromParams(params),
    })
    return json(page)
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? (error as { code?: unknown }).code : null
    // The save folder is made by the first save; until then it is just empty.
    if (code === 'ENOENT' && dir.writable) return json(params.get('models') === '1' ? { models: [] } : { items: [], nextCursor: null })
    if (code === 'ENOENT') return jsonError('The folder does not exist', 404)
    console.error('Gallery listing failed:', error)
    return jsonError('Could not read the folder', 500)
  }
}
