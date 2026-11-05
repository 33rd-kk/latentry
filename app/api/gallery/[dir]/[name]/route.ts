import path from 'node:path'
import type { BigIntStats } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import type { NextRequest } from 'next/server'
import { jsonError } from '@/lib/api'
import { dirFor } from '@/lib/gallery/access'
import { openInDir } from '@/lib/gallery/fs'
import { thumbnail } from '@/lib/gallery/thumbs'
import { attachment } from '@/lib/gallery/zip'
import { serverMessage } from '@/lib/i18n/core'
import { stripMetadata } from '@/lib/image-meta'

export const runtime = 'nodejs'

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
}

/**
 * One picture from a gallery folder, or its thumbnail with `?thumb=1`.
 * `?download=clean` saves it without its settings (lib/image-meta/strip.ts),
 * `?download=original` as it is; a picture that cannot be cleaned is refused
 * rather than saved with them.
 * The folder is an index and the name a bare file name; anything else, or a
 * symlink leading out of the folder (even one swapped in while this runs: see
 * openInDir), is a 404.
 */
export async function GET(request: NextRequest, ctx: RouteContext<'/api/gallery/[dir]/[name]'>) {
  const { dir: dirParam, name } = await ctx.params
  const dir = dirFor(request.headers, dirParam)
  if (!dir) return jsonError('Not found', 404)
  const opened = await openInDir(dir, name)
  if (!opened) return jsonError('Not found', 404)
  const { handle, file, info } = opened
  try {
    return await respond(request, handle, file, info)
  } finally {
    await handle.close()
  }
}

async function respond(request: NextRequest, handle: FileHandle, file: string, info: BigIntStats): Promise<Response> {
  const version = `${info.mtimeMs}-${info.size}`
  const headers = {
    // Not kept by the browser at all: a disk cache would hold every picture
    // viewed, secret mode or not, long after the tab is closed. Thumbnails are
    // cached in this server's memory instead (lib/gallery/thumbs.ts).
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  }

  try {
    if (request.nextUrl.searchParams.get('thumb')) {
      const webp = await thumbnail(`${file}|${version}`, () => handle.readFile())
      return new Response(new Uint8Array(webp), { headers: { ...headers, 'Content-Type': 'image/webp' } })
    }
    const bytes = await handle.readFile()
    const type = CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
    const download = request.nextUrl.searchParams.get('download')
    if (download === 'clean') {
      const clean = stripMetadata(bytes)
      if (!clean) return jsonError(serverMessage('gallery.download.notCleaned'), 422)
      return new Response(new Uint8Array(clean), { headers: { ...headers, 'Content-Type': type, 'Content-Disposition': attachment(path.basename(file)) } })
    }
    return new Response(new Uint8Array(bytes), {
      headers: { ...headers, 'Content-Type': type, ...(download === 'original' ? { 'Content-Disposition': attachment(path.basename(file)) } : {}) },
    })
  } catch (error) {
    console.error('Gallery read failed:', error)
    return jsonError('Could not read the picture', 500)
  }
}
