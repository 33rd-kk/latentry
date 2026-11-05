// Which gallery folders a request may see. Every route that takes a folder
// goes through here (a verify script checks), so a folder that is not shared
// with paired devices answers a paired device exactly as a folder that does
// not exist: it cannot tell the difference.

import { viewerOf, type Viewer } from '@/lib/security/viewer'
import { getGalleryDirs, type GalleryDir } from './dirs'

type Env = Record<string, string | undefined>

/** The folders `viewer` may see, with their indexes as they are (gaps and all). */
export function visibleDirs(viewer: Viewer, dirs: GalleryDir[] = getGalleryDirs()): GalleryDir[] {
  return viewer.all ? dirs : dirs.filter((dir) => dir.shared)
}

/** The folder a request names by its index, if it may see it. */
export function dirFor(headers: Headers, index: unknown, env: Env = process.env): GalleryDir | undefined {
  const number = typeof index === 'number' ? index : typeof index === 'string' && /^\d+$/.test(index) ? Number(index) : NaN
  if (!Number.isInteger(number)) return undefined
  return visibleDirs(viewerOf(headers, env), getGalleryDirs(env)).find((dir) => dir.index === number)
}
