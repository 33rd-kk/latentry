// Which folders the gallery shows, from the environment.
//
//   GALLERY_SAVE_DIR=D:\pictures\latentry          written to: every finished image, WD14 tags
//   GALLERY_DIRS=D:\comfy\output;E:\webui\outputs   read only: anything else worth browsing
//
// The browser only ever names a folder by its index in this list, never by a
// path, so nothing it sends can point the server at another directory. The
// save folder, when set, is always index 0.

import path from 'node:path'

type Env = Record<string, string | undefined>

export interface GalleryDir {
  index: number
  /** Absolute, normalised. Server-side only. */
  path: string
  /** The folder's own name, which is all the browser is shown. */
  label: string
  writable: boolean
}

function splitPaths(value: string | undefined): string[] {
  // `;` everywhere, since `:` is part of a Windows path.
  return (value ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
}

/** Pure, so the verify script can feed it any environment. */
export function parseGalleryDirs(env: Env): GalleryDir[] {
  const dirs: GalleryDir[] = []
  const seen = new Set<string>()
  const add = (raw: string, writable: boolean) => {
    const resolved = path.resolve(raw)
    // Windows paths are case-insensitive; compare them that way.
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved
    if (seen.has(key)) return
    seen.add(key)
    dirs.push({ index: dirs.length, path: resolved, label: path.basename(resolved) || resolved, writable })
  }
  const save = env.GALLERY_SAVE_DIR?.trim()
  if (save) add(save, true)
  for (const dir of splitPaths(env.GALLERY_DIRS)) add(dir, false)
  return dirs
}

export function getGalleryDirs(env: Env = process.env): GalleryDir[] {
  return parseGalleryDirs(env)
}

export function getSaveDir(env: Env = process.env): GalleryDir | null {
  return parseGalleryDirs(env).find((dir) => dir.writable) ?? null
}
