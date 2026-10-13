// The files that hold Latentry's settings and secrets, made owner-only once
// when the server starts (see lib/security/owner-only.ts). Each is also
// restricted when it is written, and when it is first read; doing it at start
// as well means a file from an older version, or one copied in, is not left
// readable by others until something happens to use it.

import { existsSync } from 'node:fs'
import { folderNamesKeyPath } from '@/lib/gallery/folder-names'
import { restrictExistingToOwner } from '@/lib/security/owner-only'
import { devicesPath, keyPath } from '@/lib/security/pairing'
import { settingsPath } from '@/lib/settings/store'

type Env = Record<string, string | undefined>

/** The settings file, the pairing key, the paired-device list and the folder-name key. */
export function privateFiles(env: Env = process.env): string[] {
  return [settingsPath(env), keyPath(env), devicesPath(env), folderNamesKeyPath(env)]
}

/** Restricts those of them that exist; answers which. */
export function restrictPrivateFiles(env: Env = process.env, platform: NodeJS.Platform = process.platform): string[] {
  const existing = privateFiles(env).filter((file) => existsSync(file))
  for (const file of existing) restrictExistingToOwner(file, platform)
  return existing
}
