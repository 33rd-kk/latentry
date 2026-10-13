// Names for gallery folders that have no display name of their own.
//
// A folder's real name ("ComfyUI", "D:\") says something about this computer,
// and the gallery is shown to paired devices too. So a folder is shown by the
// name set for it on the Settings page, or else by a made-up one like
// "Amber Fox": the same for the same folder every time, chosen by a keyed
// hash so that nobody without this install's key can tell the folder from
// its name.
//
// The key is its own file next to the settings file
// (latentry.folder-names-key), apart from pairing: forgetting devices or
// moving the pairing key to a keychain leaves the names alone. Deleting the
// file gives every unnamed folder a new name.

import { createHmac, randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { restrictExistingToOwner, restrictToOwner } from '@/lib/security/owner-only'
import { settingsPath } from '@/lib/settings/store'

type Env = Record<string, string | undefined>

const ADJECTIVES = [
  'Amber', 'Azure', 'Brisk', 'Calm', 'Coral', 'Crimson', 'Dusky', 'Ember',
  'Fern', 'Frost', 'Gentle', 'Golden', 'Hazel', 'Ivory', 'Jade', 'Kind',
  'Lunar', 'Misty', 'Noble', 'Olive', 'Pale', 'Quiet', 'Rosy', 'Sable',
  'Silver', 'Sunny', 'Teal', 'Umber', 'Velvet', 'Warm', 'Wild', 'Young',
]

const NOUNS = [
  'Badger', 'Brook', 'Cedar', 'Comet', 'Crane', 'Dune', 'Falcon', 'Fox',
  'Grove', 'Harbor', 'Heron', 'Island', 'Lark', 'Maple', 'Meadow', 'Moth',
  'Otter', 'Owl', 'Pebble', 'Pine', 'Quail', 'Raven', 'Reef', 'River',
  'Robin', 'Sparrow', 'Summit', 'Thistle', 'Tide', 'Valley', 'Willow', 'Wren',
]

/** The made-up name for the folder whose normalised path is `folder`. Pure. */
export function autoFolderName(key: Buffer, folder: string): string {
  const digest = createHmac('sha256', key).update(folder).digest()
  return `${ADJECTIVES[digest[0] % ADJECTIVES.length]} ${NOUNS[digest[1] % NOUNS.length]}`
}

export function folderNamesKeyPath(env: Env = process.env): string {
  return path.join(path.dirname(settingsPath(env)), 'latentry.folder-names-key')
}

const globalForNames = globalThis as typeof globalThis & { __folderNamesKey?: { file: string; key: Buffer } }

function readKey(file: string): Buffer | null {
  try {
    const key = Buffer.from(readFileSync(file, 'utf8').trim(), 'hex')
    return key.length >= 32 ? key : null
  } catch {
    return null
  }
}

/** This install's key for made-up names: read from its file, or made (0600) the first time. */
export function folderNamesKey(env: Env = process.env): Buffer {
  const file = folderNamesKeyPath(env)
  const cached = globalForNames.__folderNamesKey
  if (cached?.file === file) return cached.key
  let key = readKey(file)
  if (!key) {
    try {
      // 'wx': if two requests race to make it, the second reads the first's.
      writeFileSync(file, randomBytes(32).toString('hex') + '\n', { mode: 0o600, flag: 'wx' })
      restrictToOwner(file)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    key = readKey(file)
    if (!key) throw new Error(`${path.basename(file)} is not a key`)
  }
  restrictExistingToOwner(file)
  globalForNames.__folderNamesKey = { file, key }
  return key
}
