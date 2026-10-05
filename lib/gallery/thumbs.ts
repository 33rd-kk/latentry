// Thumbnails for the gallery grid: the long side cut to THUMB_EDGE as WebP,
// made on first request and kept in memory.

import sharp from 'sharp'

export const THUMB_EDGE = 384
// ~20 KB each, so this is a few tens of megabytes at most.
const CACHE_MAX = 1500

const globalForThumbs = globalThis as typeof globalThis & { __galleryThumbs?: Map<string, Buffer> }
const cache = (globalForThumbs.__galleryThumbs ??= new Map())

/**
 * The thumbnail of a picture, `read` only on a cache miss. `key` names the
 * file and must change whenever it does (its path, mtime and size are enough).
 */
export async function thumbnail(key: string, read: () => Promise<Buffer>): Promise<Buffer> {
  const cacheKey = key
  const hit = cache.get(cacheKey)
  if (hit) {
    // Re-insert, so Map order doubles as least-recently-used.
    cache.delete(cacheKey)
    cache.set(cacheKey, hit)
    return hit
  }
  const webp = await sharp(await read())
    .rotate()
    .resize(THUMB_EDGE, THUMB_EDGE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer()
  cache.set(cacheKey, webp)
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  return webp
}
