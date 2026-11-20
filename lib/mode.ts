// Gallery-only mode: Latentry only browses pictures. Generation, the engine,
// the backends and model downloads are off, and their API routes answer 403
// (proxy.ts), so turning the mode on also closes what it hides.
//
//   LATENTRY_MODE=gallery | full     (wins over the settings page)
//
// What stays: the gallery and everything in it, the built-in WD14 tagger
// (it runs in this process, with onnxruntime-node) and its model download,
// Settings, Setup's tagger card, and pairing.
//
// Pure, apart from reading the settings file through getSettings().

import { isAppMode, type AppMode, type Settings } from '@/lib/settings/schema'
import { getSettings } from '@/lib/settings/store'

type Env = Record<string, string | undefined>

/** The mode set by LATENTRY_MODE, or null when the environment leaves it to Settings. */
export function modeFromEnv(env: Env = process.env): AppMode | null {
  const value = env.LATENTRY_MODE?.trim().toLowerCase()
  return isAppMode(value) ? value : null
}

/** The mode in effect: LATENTRY_MODE, else the settings file, else `full`. */
export function appMode(env: Env = process.env, settings: Settings = getSettings()): AppMode {
  return modeFromEnv(env) ?? settings.mode ?? 'full'
}

/** Whether the mode was chosen, by LATENTRY_MODE or on Settings (or the first-run question). */
export function modeChosen(env: Env = process.env, settings: Settings = getSettings()): boolean {
  return modeFromEnv(env) !== null || settings.mode !== undefined
}

export function galleryOnly(env: Env = process.env, settings: Settings = getSettings()): boolean {
  return appMode(env, settings) === 'gallery'
}

/**
 * The gallery folder to open on in gallery-only mode: the first one, unless it
 * is the save folder, empty (nothing is saved in this mode), and a read-only
 * folder follows; then the first read-only folder. Null when there is none.
 */
export async function galleryOnlyStart<D extends { index: number; writable: boolean }>(
  dirs: readonly D[],
  hasPictures: (dir: D) => Promise<boolean>
): Promise<number | null> {
  const first = dirs[0]
  if (!first) return null
  const readOnly = dirs.find((dir) => !dir.writable)
  if (!first.writable || !readOnly || (await hasPictures(first))) return first.index
  return readOnly.index
}

/** Under /api/gen, the two the gallery uses: the backend list (empty here) and WD14 tags. */
const OPEN_GEN = new Set(['/api/gen/backends', '/api/gen/tag'])

/**
 * Generation's own routes, closed with everything under them. Settings' test
 * of a backend address goes too: this mode reaches no backend.
 */
const CLOSED = ['/api/control', '/api/wildcards', '/api/models/info', '/api/settings/test']

/**
 * Whether gallery-only mode closes this API route. The engine's status
 * (GET /api/engine) stays open for Setup's tagger card, and the model
 * download route stays open because it refuses everything but a tagger
 * itself (app/api/engine/models/download/route.ts): which model is asked for
 * is in the body, not the path.
 */
export function closedInGalleryOnly(pathname: string, method: string): boolean {
  if (pathname.startsWith('/api/gen/')) return !OPEN_GEN.has(pathname)
  if (pathname === '/api/engine') return method !== 'GET'
  if (pathname === '/api/engine/models/download') return false
  if (pathname.startsWith('/api/engine/')) return true
  return CLOSED.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}
