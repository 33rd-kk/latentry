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
import { autoFolderName, folderNamesKey } from './folder-names'

type Env = Record<string, string | undefined>

export interface GalleryDir {
  index: number
  /** Absolute, normalised. Server-side only. */
  path: string
  /**
   * What the browser is shown: the display name set on the Settings page,
   * or else a made-up one (./folder-names.ts). Never the folder's own name.
   */
  label: string
  /** Whether `label` is made up rather than set. */
  autoLabel: boolean
  writable: boolean
}

/** A folder path as compared: resolved, and case-folded where the file system is. */
export function folderKey(folder: string, platform: NodeJS.Platform = process.platform): string {
  const resolved = path.resolve(folder)
  return platform === 'win32' ? resolved.toLowerCase() : resolved
}

function splitPaths(value: string | undefined): string[] {
  // `;` everywhere, since `:` is part of a Windows path.
  return (value ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
}

/**
 * Pure, so the verify script can feed it any environment, settings and key.
 * `nameKey` makes the names of folders without one (see ./folder-names.ts);
 * without it they are "Folder 1", "Folder 2"…
 */
export function parseGalleryDirs(env: Env, settings: Settings = { version: 1 }, nameKey?: Buffer): GalleryDir[] {
  const dirs: GalleryDir[] = []
  const seen = new Set<string>()
  const gallery = settings.gallery ?? {}
  const labels = new Map(Object.entries(gallery.labels ?? {}).map(([folder, label]) => [folderKey(folder), label]))
  const used = new Set<string>()
  const add = (raw: string, writable: boolean) => {
    // Windows paths are case-insensitive; compare them that way.
    const key = folderKey(raw)
    if (seen.has(key)) return
    seen.add(key)
    const set = labels.get(key)
    let label = set ?? (nameKey ? autoFolderName(nameKey, key) : `Folder ${dirs.length + 1}`)
    // Two folders never share a name in the tabs.
    for (let n = 2; used.has(label.toLowerCase()); n += 1) label = `${set ?? label.replace(/ \d+$/, '')} ${n}`
    used.add(label.toLowerCase())
    dirs.push({ index: dirs.length, path: path.resolve(raw), label, autoLabel: set === undefined, writable })
  }
  const save = gallery.saveDir !== undefined ? gallery.saveDir : env.GALLERY_SAVE_DIR?.trim()
  if (save) add(save, true)
  for (const dir of gallery.dirs ?? splitPaths(env.GALLERY_DIRS)) add(dir, false)
  return dirs
}

export function getGalleryDirs(env: Env = process.env): GalleryDir[] {
  return parseGalleryDirs(env, getSettings(), folderNameKey(env))
}

/** This install's key for made-up folder names; none (so "Folder 1"…) if it cannot be read or made. */
function folderNameKey(env: Env): Buffer | undefined {
  try {
    return folderNamesKey(env)
  } catch {
    return undefined
  }
}

export function getSaveDir(env: Env = process.env): GalleryDir | null {
  return getGalleryDirs(env).find((dir) => dir.writable) ?? null
}

/** GALLERY_AUTO_TAG, or what the settings page set. */
/** Whether saved pictures say which LoRA files made them (settings only; off by default). */
export function loraHashesEnabled(settings: Settings = getSettings()): boolean {
  return settings.gallery?.loraHashes === true
}

export function autoTagEnabled(env: Env = process.env, settings: Settings = getSettings()): boolean {
  return settings.gallery?.autoTag ?? env.GALLERY_AUTO_TAG?.trim() === '1'
}
