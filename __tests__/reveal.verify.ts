/**
 * Showing a picture outside the browser (lib/gallery/reveal.ts): the command
 * for each system, the picture checks, and that only this machine may ask
 * (lib/settings/access.ts). No program is started: the launcher is replaced.
 *
 * Run with: npm test -- reveal
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { check, done, eq } from './assert'
import { isOpenAction, openCommand, openPicture, type OpenCommand } from '../lib/gallery/reveal'
import { isFromThisMachine } from '../lib/settings/access'
import type { GalleryDir } from '../lib/gallery/dirs'

async function main() {
  // ── Commands ──
  const file = 'C:\\pictures\\my folder\\a b.png'
  eq(openCommand('win32', file, 'reveal'), { command: 'explorer.exe', args: ['/select,"C:\\pictures\\my folder\\a b.png"'], verbatim: true }, 'Windows: select it in Explorer, quoted as Explorer wants')
  eq(openCommand('win32', file, 'open'), { command: 'explorer.exe', args: ['"C:\\pictures\\my folder\\a b.png"'], verbatim: true }, 'Windows: the default app')
  eq(openCommand('darwin', '/Users/x/p/a.png', 'reveal'), { command: 'open', args: ['-R', '/Users/x/p/a.png'], verbatim: false }, 'macOS: reveal in Finder')
  eq(openCommand('darwin', '/Users/x/p/a.png', 'open'), { command: 'open', args: ['/Users/x/p/a.png'], verbatim: false }, 'macOS: the default app')
  eq(openCommand('linux', '/home/x/p/a.png', 'reveal'), { command: 'xdg-open', args: ['/home/x/p'], verbatim: false }, 'Linux: its folder')
  eq(openCommand('linux', '/home/x/p/a.png', 'open'), { command: 'xdg-open', args: ['/home/x/p/a.png'], verbatim: false }, 'Linux: the default app')
  eq([isOpenAction('reveal'), isOpenAction('open'), isOpenAction('delete'), isOpenAction(undefined)], [true, true, false, false], 'only reveal and open')

  // ── Only pictures inside the folder are shown ──
  const root = await mkdtemp(path.join(tmpdir(), 'latentry-reveal-'))
  try {
    const folder = path.join(root, 'out')
    await mkdir(folder)
    await writeFile(path.join(folder, 'a.png'), 'x')
    await writeFile(path.join(root, 'outside.png'), 'x')
    await writeFile(path.join(folder, 'notes.txt'), 'x')
    const dir: GalleryDir = { index: 0, path: folder, label: 'out', writable: false }
    const started: OpenCommand[] = []
    const run = (command: OpenCommand) => void started.push(command)

    check(await openPicture(dir, 'a.png', 'reveal', run, 'darwin'), 'a picture in the folder')
    eq(started.map((command) => command.args), [['-R', path.join(await realRoot(folder), 'a.png')]], 'by its real path')
    for (const name of ['../outside.png', 'missing.png', 'notes.txt', '', '..\\outside.png']) {
      check(!(await openPicture(dir, name, 'open', run, 'darwin')), `refused: ${JSON.stringify(name)}`)
    }
    eq(started.length, 1, 'nothing started for a refused name')
  } finally {
    await rm(root, { recursive: true, force: true })
  }

  // ── Only from this machine ──
  const headers = (host: string, forwarded?: string) => new Headers({ host, ...(forwarded ? { 'x-forwarded-for': forwarded } : {}) })
  check(isFromThisMachine(headers('localhost:3000', '127.0.0.1')), 'localhost')
  check(isFromThisMachine(headers('127.0.0.1:3000', '::1')), 'loopback by IP')
  check(!isFromThisMachine(headers('192.168.1.20:3000', '192.168.1.30')), 'not a phone on the LAN')
  check(!isFromThisMachine(headers('localhost:3000', '192.168.1.30')), 'not a LAN client behind a localhost Host')
  check(!isFromThisMachine(headers('192.168.1.20:3000', '127.0.0.1')), 'not a LAN Host, whatever it forwards')

  done('reveal')
}

/** The folder as resolveInDir sees it (temp folders can sit behind a link). */
async function realRoot(folder: string): Promise<string> {
  const { realpath } = await import('node:fs/promises')
  return realpath(folder)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
