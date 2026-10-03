// Which folders the gallery shows, from the environment.
//
//   GALLERY_SAVE_DIR=D:\pictures\latentry          written to: every finished image, WD14 tags
//   GALLERY_DIRS=D:\comfy\output;E:\webui\outputs   read only: anything else worth browsing
//
// The settings page can set both (latentry.settings.json); what it sets
// replaces the variable, what it leaves alone falls back to it.
//
// The browser only ever names a folder by its index in this list, never by a
// path. The save folder, when set, is always index 0.

import path from 'node:path'
import type { Settings } from '@/lib/settings/schema'
import { getSettings } from '@/lib/settings/store'

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

/** Pure, so the verify script can feed it any environment and settings. */
export function parseGalleryDirs(env: Env, settings: Settings = { version: 1 }): GalleryDir[] {
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
  const gallery = settings.gallery ?? {}
  const save = gallery.saveDir !== undefined ? gallery.saveDir : env.GALLERY_SAVE_DIR?.trim()
  if (save) add(save, true)
  for (const dir of gallery.dirs ?? splitPaths(env.GALLERY_DIRS)) add(dir, false)
  return dirs
}

export function getGalleryDirs(env: Env = process.env): GalleryDir[] {
  return parseGalleryDirs(env, getSettings())
}

export function getSaveDir(env: Env = process.env): GalleryDir | null {
  return getGalleryDirs(env).find((dir) => dir.writable) ?? null
}

/** GALLERY_AUTO_TAG, or what the settings page set. */
export function autoTagEnabled(env: Env = process.env, settings: Settings = getSettings()): boolean {
  return settings.gallery?.autoTag ?? env.GALLERY_AUTO_TAG?.trim() === '1'
}
