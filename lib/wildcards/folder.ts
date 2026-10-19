// A wildcards folder on disk: `name.txt` files, in subfolders up to
// MAX_WILDCARD_DEPTH deep, read-only. Nothing outside the folder is ever
// read: a name is checked part by part, and the file's real path (links
// followed) must still be inside the folder's real path.
//
// Free of Latentry imports, so it can be split out with ./expand.ts.

import { open, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { MAX_WILDCARD_DEPTH, wildcardLines, wildcardPath } from './syntax'

/** The largest wildcard file read, in bytes. */
export const MAX_WILDCARD_BYTES = 1024 * 1024
/** The most wildcards a folder lists. */
export const MAX_WILDCARDS = 2000

/** A file read whole, if it is a file of at most `max` bytes. */
async function readCapped(file: string, max: number): Promise<string | null> {
  const handle = await open(file, 'r')
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > max) return null
    return (await handle.readFile()).toString('utf8')
  } finally {
    await handle.close()
  }
}

/** One wildcard's lines, or null when the name is not a file inside `dir`. */
export async function readWildcard(dir: string, name: string): Promise<string[] | null> {
  const relative = wildcardPath(name)
  if (!relative) return null
  try {
    const root = await realpath(dir)
    const file = await realpath(path.join(root, ...relative.split('/')) + '.txt')
    if (!file.startsWith(root + path.sep)) return null
    const text = await readCapped(file, MAX_WILDCARD_BYTES)
    return text === null ? null : wildcardLines(text)
  } catch {
    return null
  }
}

/** The wildcards in `dir`, by name (`dir/name` for subfolders), sorted. Names only; nothing is read. */
export async function listWildcards(dir: string): Promise<string[]> {
  const names: string[] = []
  const walk = async (folder: string, prefix: string[], depth: number) => {
    let entries
    try {
      entries = await readdir(folder, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (names.length >= MAX_WILDCARDS) return
      if (entry.isFile() && /\.txt$/i.test(entry.name)) {
        const name = [...prefix, entry.name.slice(0, -'.txt'.length)].join('/')
        if (wildcardPath(name)) names.push(name)
      } else if (entry.isDirectory() && depth + 1 < MAX_WILDCARD_DEPTH && !entry.name.startsWith('.')) {
        await walk(path.join(folder, entry.name), [...prefix, entry.name], depth + 1)
      }
    }
  }
  await walk(dir, [], 0)
  return names.sort((a, b) => a.localeCompare(b))
}
