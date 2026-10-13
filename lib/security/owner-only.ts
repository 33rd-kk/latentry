// Files only their owner may read, on Windows too.
//
// The settings file, the pairing key, the paired-device list and the
// folder-name key are written with mode 0o600. On Windows Node turns a mode
// into nothing but the read-only flag, so such a file takes its folder's
// access list: private under the user's profile, but readable by every user
// of the computer in a folder like C:\latentry. This replaces the list with
// one that names only the owner (and Windows itself, for backups and the
// like). A file made by an elevated process keeps the Administrators entry
// its creator's token gives it. icacls and whoami are run without a shell.

import { execFileSync } from 'node:child_process'
import path from 'node:path'

/** The SYSTEM account, which Windows' own services run as. */
const SYSTEM_SID = 'S-1-5-18'

/** A tool from Windows' own folder, never a same-named one earlier on PATH (Git's whoami, say). */
function systemTool(name: string): string {
  return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', name)
}

let ownerSid: string | null | undefined

/** The current user's security identifier, found once. */
function currentUserSid(): string | null {
  if (ownerSid !== undefined) return ownerSid
  try {
    const out = execFileSync(systemTool('whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true, timeout: 10_000 })
    ownerSid = /"(S-1-[\d-]+)"/.exec(out)?.[1] ?? null
  } catch {
    ownerSid = null
  }
  return ownerSid
}

/**
 * Leaves `file` readable and writable by the current user only. Call it on a
 * temp file before renaming it into place, so the file is never readable by
 * others. Elsewhere than Windows it does nothing: the 0o600 mode does this.
 * A failure is logged, not thrown, so saving still works.
 */
export function restrictToOwner(file: string, platform: NodeJS.Platform = process.platform): void {
  if (platform !== 'win32') return
  const sid = currentUserSid()
  if (!sid) {
    console.warn('[security] could not find the current Windows user; a private file keeps its folder\'s permissions')
    return
  }
  try {
    execFileSync(systemTool('icacls.exe'), [file, '/inheritance:r', '/grant:r', `*${sid}:(F)`, `*${SYSTEM_SID}:(F)`], {
      windowsHide: true,
      stdio: 'ignore',
      timeout: 10_000,
    })
  } catch (error) {
    console.warn('[security] could not make a private file owner-only:', error instanceof Error ? error.message : error)
  }
}

const globalForOwnerOnly = globalThis as unknown as { __ownerOnlyChecked?: Set<string> }

/**
 * restrictToOwner for a file that already exists, once per file and process:
 * a file written by an older version still has its folder's permissions.
 */
export function restrictExistingToOwner(file: string, platform: NodeJS.Platform = process.platform): void {
  if (platform !== 'win32') return
  const checked = (globalForOwnerOnly.__ownerOnlyChecked ??= new Set())
  if (checked.has(file)) return
  checked.add(file)
  restrictToOwner(file, platform)
}
