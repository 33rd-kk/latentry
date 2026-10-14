// The engine's version in Latentry's own folder (engine/latentry_engine/__init__.py).
// The engine is installed from that folder in editable mode, so a running
// engine that reports another version was started before Latentry was
// updated: Setup says so, so the owner restarts it.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { enginePaths } from './paths'

/** `__version__ = "0.6.1"` in `text`, or null. */
export function versionIn(text: string): string | null {
  return /^__version__\s*=\s*["']([^"']+)["']/m.exec(text)?.[1] ?? null
}

/** The version of the engine in this folder, or null when it cannot be read. */
export function sourceEngineVersion(): string | null {
  try {
    return versionIn(readFileSync(path.join(enginePaths().engineSource, 'latentry_engine', '__init__.py'), 'utf8'))
  } catch {
    return null
  }
}
