import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { NextRequest } from 'next/server'
import { jsonError } from '@/lib/api'
import { getGalleryDirs } from '@/lib/gallery/dirs'
import { resolveInDir } from '@/lib/gallery/fs'
import { thumbnail } from '@/lib/gallery/thumbs'

export const runtime = 'nodejs'

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
}

/**
 * One picture from a gallery folder, or its thumbnail with `?thumb=1`.
 * The folder is an index and the name a bare file name; anything else, or a
 * symlink leading out of the folder, is a 404.
 */
export async function GET(request: NextRequest, ctx: RouteContext<'/api/gallery/[dir]/[name]'>) {
  const { dir: dirParam, name } = await ctx.params
  const dir = /^\d+$/.test(dirParam) ? getGalleryDirs()[Number(dirParam)] : undefined
  if (!dir) return jsonError('Not found', 404)
  const file = await resolveInDir(dir, name)
  if (!file) return jsonError('Not found', 404)

  const info = await stat(file)
  const version = `${Math.floor(info.mtimeMs)}-${info.size}`
  const etag = `"${version}${request.nextUrl.searchParams.get('thumb') ? '-t' : ''}"`
  const headers = {
    // Private: these are the user's own pictures, not for a shared cache.
    'Cache-Control': 'private, max-age=3600',
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
  }
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers })

  try {
    if (request.nextUrl.searchParams.get('thumb')) {
      const webp = await thumbnail(file, version)
      return new Response(new Uint8Array(webp), { headers: { ...headers, 'Content-Type': 'image/webp' } })
    }
    const bytes = await readFile(file)
    return new Response(new Uint8Array(bytes), {
      headers: { ...headers, 'Content-Type': CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream' },
    })
  } catch (error) {
    console.error('Gallery read failed:', error)
    return jsonError('Could not read the picture', 500)
  }
}
