// Writing a whole file so that a reader sees the old one or the new one,
// never half of either: write beside it under a hidden temporary name, then
// rename over it. Settings, ratings, model info and saved pictures go
// through here. (lib/pairing keeps its own, synchronous one, as that folder
// imports nothing from the app.)

import { randomBytes } from 'node:crypto'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { restrictToOwner } from '@/lib/security/owner-only'

export interface AtomicWriteOptions {
  /** Readable by this user only: mode 0600, and on Windows the file's ACL. */
  ownerOnly?: boolean
  /** Stand-ins for tests. */
  fs?: { rename?: typeof rename; writeFile?: typeof writeFile }
}

// Windows refuses to rename over a file another process has open for a moment
// (a reader, a virus scanner, the search indexer): EPERM, EBUSY or EACCES.
// It clears quickly, so the rename is tried again a few times, 25 ms longer
// each time (0.7 s in all), before the error is passed on.
const BUSY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])
export const RENAME_TRIES = 8

/** The temporary file's name beside `file`: hidden, and never a name a reader looks for. */
export function tempPath(file: string): string {
  return path.join(path.dirname(file), `.${path.basename(file)}.${randomBytes(4).toString('hex')}.tmp`)
}

async function renameOver(from: string, to: string, doRename: typeof rename): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await doRename(from, to)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (attempt >= RENAME_TRIES || !code || !BUSY_CODES.has(code)) throw error
      await new Promise((resolve) => setTimeout(resolve, 25 * attempt))
    }
  }
}

/**
 * Writes `data` to `file`, making its folder if needed. On any failure the
 * temporary file is removed and the error passed on; `file` is then as it was.
 */
export async function writeFileAtomic(file: string, data: string | Uint8Array, options: AtomicWriteOptions = {}): Promise<void> {
  const temp = tempPath(file)
  try {
    await mkdir(path.dirname(file), { recursive: true })
    await (options.fs?.writeFile ?? writeFile)(temp, data, options.ownerOnly ? { mode: 0o600 } : undefined)
    if (options.ownerOnly) restrictToOwner(temp)
    await renameOver(temp, file, options.fs?.rename ?? rename)
  } catch (error) {
    await unlink(temp).catch(() => {})
    throw error
  }
}
