// A wildcards folder on disk: `name.txt` files, and `.yaml` / `.yml` files
// whose keys name wildcards, in subfolders up to MAX_WILDCARD_DEPTH deep,
// read-only. Nothing outside the folder is ever read: a name is checked part
// by part, and the file's real path (links followed) must still be inside the
// folder's real path.
//
// A YAML file holds wildcards as the Dynamic Prompts extension reads them: a
// map whose keys are names and whose lists are the choices, nested maps for
// `__group/name__`. The file's own name is not part of the wildcard's, so
// `colors.yaml` with `warm: [red, orange]` gives `__warm__`; in a subfolder
// `styles/`, `__styles/warm__`. A `.txt` file of the same name wins.
//
// Free of Latentry imports, so it can be split out with ./expand.ts.

import { open, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { parse } from 'yaml'
import { MAX_WILDCARD_DEPTH, wildcardLines, wildcardPath } from './syntax'

/** The largest wildcard file read, in bytes. */
export const MAX_WILDCARD_BYTES = 1024 * 1024
/** The most wildcards a folder lists. */
export const MAX_WILDCARDS = 2000
/** The most YAML files read in one folder. */
const MAX_YAML_FILES = 100

const YAML_FILE = /\.ya?ml$/i

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

/** A file's text, when its real path is inside `root` (already a real path). */
async function readInside(root: string, file: string): Promise<string | null> {
  try {
    const real = await realpath(file)
    if (!real.startsWith(root + path.sep)) return null
    return await readCapped(real, MAX_WILDCARD_BYTES)
  } catch {
    return null
  }
}

/**
 * A YAML file's contents, or null when it cannot be read as one. No aliases
 * (a small file cannot grow into a large one) and no custom tags.
 */
function parseYaml(text: string): unknown {
  try {
    return parse(text.replace(/^﻿/, ''), { maxAliasCount: 0, schema: 'core' })
  } catch {
    return null
  }
}

const isMap = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

/** A YAML list's choices, as a text file's lines would be. */
function yamlChoices(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  return wildcardLines(value.filter((item) => typeof item === 'string' || typeof item === 'number').join('\n'))
}

/** The YAML files directly in `folder`, sorted, so the first to hold a name is always the same. */
async function yamlFiles(folder: string): Promise<string[]> {
  try {
    const entries = await readdir(folder, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && YAML_FILE.test(entry.name))
      .map((entry) => entry.name)
      .sort()
      .slice(0, MAX_YAML_FILES)
  } catch {
    return []
  }
}

/** One wildcard's lines, or null when the name is not a file (or a YAML key) inside `dir`. */
export async function readWildcard(dir: string, name: string): Promise<string[] | null> {
  const relative = wildcardPath(name)
  if (!relative) return null
  let root: string
  try {
    root = await realpath(dir)
  } catch {
    return null
  }
  const segments = relative.split('/')
  const text = await readInside(root, path.join(root, ...segments) + '.txt')
  if (text !== null) return wildcardLines(text)

  // In a YAML file: the first parts are folders, the rest keys.
  for (let folders = segments.length - 1; folders >= 0; folders--) {
    const folder = path.join(root, ...segments.slice(0, folders))
    const keys = segments.slice(folders)
    for (const file of await yamlFiles(folder)) {
      const yaml = await readInside(root, path.join(folder, file))
      if (yaml === null) continue
      let value = parseYaml(yaml)
      for (const key of keys) value = isMap(value) && Object.hasOwn(value, key) ? value[key] : undefined
      const choices = yamlChoices(value)
      if (choices) return choices
    }
  }
  return null
}

/** The names a YAML file's contents give, under `prefix` (its folder's parts). */
function yamlNames(value: unknown, prefix: string[], out: string[]): void {
  if (!isMap(value) || prefix.length >= MAX_WILDCARD_DEPTH) return
  for (const [key, inner] of Object.entries(value)) {
    if (out.length >= MAX_WILDCARDS) return
    const parts = [...prefix, key]
    if (Array.isArray(inner)) {
      const name = parts.join('/')
      if (wildcardPath(name)) out.push(name)
    } else {
      yamlNames(inner, parts, out)
    }
  }
}

/** The wildcards in `dir`, by name (`dir/name` for subfolders), sorted. Text files are listed by name only; YAML files are read for their keys. */
export async function listWildcards(dir: string): Promise<string[]> {
  const names: string[] = []
  let root: string
  try {
    root = await realpath(dir)
  } catch {
    return names
  }
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
    for (const file of await yamlFiles(folder)) {
      if (names.length >= MAX_WILDCARDS) return
      const yaml = await readInside(root, path.join(folder, file))
      if (yaml !== null) yamlNames(parseYaml(yaml), prefix, names)
    }
  }
  await walk(root, [], 0)
  return [...new Set(names)].sort((a, b) => a.localeCompare(b)).slice(0, MAX_WILDCARDS)
}
