// The settings file: where it lives, reading it (cheaply, on every request)
// and writing it (atomically, from the settings page).
//
//   LATENTRY_SETTINGS_FILE=/path/to/settings.json   default: ./latentry.settings.json
//
// Server-side only. Tokens are stored here in plain text, the same as in
// .env.local: keep the file out of version control (it is in .gitignore).

import { randomBytes } from 'node:crypto'
import { access, mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { EMPTY_SETTINGS, parseStoredSettings, type Settings } from './schema'

export function settingsPath(env: Record<string, string | undefined> = process.env): string {
  // A runtime path, not a source file: tell Turbopack not to trace it.
  return path.resolve(/*turbopackIgnore: true*/ env.LATENTRY_SETTINGS_FILE?.trim() || 'latentry.settings.json')
}

const globalForSettings = globalThis as typeof globalThis & {
  __latentrySettings?: { file: string; mtime: number; settings: Settings }
}

/**
 * The current settings. Re-read only when the file's mtime changes, so this is
 * cheap enough to call on every request — which is what lets a change on the
 * settings page apply without a restart.
 */
export function getSettings(): Settings {
  const file = settingsPath()
  // One open file for both the mtime and the content, so a save in between
  // cannot pair new content with the old mtime (or the reverse).
  let fd: number
  try {
    fd = openSync(/*turbopackIgnore: true*/ file, 'r')
  } catch {
    return EMPTY_SETTINGS
  }
  try {
    const mtime = fstatSync(fd).mtimeMs
    const cached = globalForSettings.__latentrySettings
    if (cached && cached.file === file && cached.mtime === mtime) return cached.settings
    let settings = EMPTY_SETTINGS
    try {
      settings = parseStoredSettings(JSON.parse(readFileSync(fd, 'utf8')))
    } catch (error) {
      console.error(`[settings] could not read ${file}:`, error)
    }
    globalForSettings.__latentrySettings = { file, mtime, settings }
    return settings
  } finally {
    closeSync(fd)
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  const file = settingsPath()
  await mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${randomBytes(4).toString('hex')}.tmp`
  try {
    await writeFile(temp, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 })
    await rename(temp, file)
  } catch (error) {
    await unlink(temp).catch(() => {})
    throw error
  }
  delete globalForSettings.__latentrySettings
}

export type DirCheck = 'ok' | 'missing' | 'notDirectory' | 'notWritable' | 'created'

/**
 * Whether a folder can serve as the gallery's save folder (`writable`) or as a
 * read-only one. With `create`, a missing save folder is made.
 */
export async function checkDir(dir: string, options: { writable?: boolean; create?: boolean } = {}): Promise<DirCheck> {
  const resolved = path.resolve(dir)
  let created = false
  try {
    const info = await stat(resolved)
    if (!info.isDirectory()) return 'notDirectory'
  } catch {
    if (!options.create) return 'missing'
    try {
      await mkdir(resolved, { recursive: true })
      created = true
    } catch {
      return 'missing'
    }
  }
  if (options.writable) {
    try {
      await access(resolved, constants.W_OK)
      const probe = path.join(resolved, `.latentry-write-test-${randomBytes(3).toString('hex')}`)
      await writeFile(probe, '')
      await unlink(probe)
    } catch {
      return 'notWritable'
    }
  }
  return created ? 'created' : 'ok'
}
