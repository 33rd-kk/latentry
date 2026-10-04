import type { NextRequest } from 'next/server'
import { jsonError, json } from '@/lib/api'
import { getGalleryDirs } from '@/lib/gallery/dirs'
import { listPage } from '@/lib/gallery/fs'

export const runtime = 'nodejs'

const MAX_LIMIT = 200

/**
 * Without `dir`: the folders (by index and name, never their paths).
 * With `dir`: one page of that folder, newest first.
 *
 *   ?dir=0&cursor=<from the last page>&limit=60&q=words&backend=id&profile=id
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
    const page = await listPage(dir, {
      cursor: params.get('cursor'),
      limit,
      filter: {
        q: params.get('q')?.trim() || undefined,
        backend: params.get('backend')?.trim() || undefined,
        profile: params.get('profile')?.trim() || undefined,
      },
    })
    return json(page)
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? (error as { code?: unknown }).code : null
    // The save folder is made by the first save; until then it is just empty.
    if (code === 'ENOENT' && dir.writable) return json({ items: [], nextCursor: null })
    if (code === 'ENOENT') return jsonError('The folder does not exist', 404)
    console.error('Gallery listing failed:', error)
    return jsonError('Could not read the folder', 500)
  }
}
