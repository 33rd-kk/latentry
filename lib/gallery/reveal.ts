// Showing a gallery picture outside the browser: in the system's file
// manager with the file selected, or in the app the system opens pictures
// with. Nothing here changes, moves or deletes a file; the gallery has no
// such actions by design.
//
// Only for requests from this machine (the route checks), since it acts on
// the screen of the computer Latentry runs on. The path comes from
// resolveInDir, so it is a picture inside a gallery folder and never a link
// leading out of one, and the program is started directly, without a shell.

import { spawn } from 'node:child_process'
import path from 'node:path'
import type { GalleryDir } from './dirs'
import { resolveInDir } from './fs'

export const OPEN_ACTIONS = ['reveal', 'open'] as const
export type OpenAction = (typeof OPEN_ACTIONS)[number]

export function isOpenAction(value: unknown): value is OpenAction {
  return typeof value === 'string' && (OPEN_ACTIONS as readonly string[]).includes(value)
}

export interface OpenCommand {
  command: string
  args: string[]
  /**
   * Windows only: pass the arguments exactly as written. explorer wants
   * `/select,"C:\a b\c.png"`, which the usual quoting would turn into
   * `"/select,C:\a b\c.png"`. A Windows path cannot hold a `"`, so writing
   * the quotes ourselves is safe.
   */
  verbatim: boolean
}

/** The program and arguments that reveal or open `file` on `platform`. */
export function openCommand(platform: NodeJS.Platform, file: string, action: OpenAction): OpenCommand {
  if (platform === 'win32') {
    return { command: 'explorer.exe', args: [action === 'reveal' ? `/select,"${file}"` : `"${file}"`], verbatim: true }
  }
  if (platform === 'darwin') {
    return { command: 'open', args: action === 'reveal' ? ['-R', file] : [file], verbatim: false }
  }
  // Linux and the rest: no common way to select a file, so its folder opens.
  return { command: 'xdg-open', args: [action === 'reveal' ? path.dirname(file) : file], verbatim: false }
}

export type Launcher = (command: OpenCommand) => void

/** Starts the program and lets it go: its exit code says nothing useful (explorer returns 1). */
export const launch: Launcher = ({ command, args, verbatim }) => {
  const child = spawn(command, args, { detached: true, stdio: 'ignore', shell: false, windowsVerbatimArguments: verbatim })
  child.on('error', (error) => console.error(`Could not start ${command}:`, error.message))
  child.unref()
}

/** Reveals or opens a picture of `dir`; false when there is no such picture. */
export async function openPicture(
  dir: GalleryDir,
  name: string,
  action: OpenAction,
  run: Launcher = launch,
  platform: NodeJS.Platform = process.platform
): Promise<boolean> {
  const file = await resolveInDir(dir, name)
  if (!file) return false
  run(openCommand(platform, file, action))
  return true
}
