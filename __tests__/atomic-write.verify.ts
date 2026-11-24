/**
 * lib/fs/atomic-write: a whole file or none of it, the temporary file always
 * cleared away, a busy rename on Windows tried again and other errors not.
 *
 * Run with: npm test -- atomic-write
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { rename as realRename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { check, done, eq } from './assert'
import { RENAME_TRIES, tempPath, writeFileAtomic } from '../lib/fs/atomic-write'

const scratch = mkdtempSync(path.join(tmpdir(), 'atomic-write-'))

function failing(code: string, times: number) {
  let calls = 0
  const rename: typeof realRename = async (from, to) => {
    calls += 1
    if (calls <= times) throw Object.assign(new Error(code), { code })
    return realRename(from, to)
  }
  return { rename, calls: () => calls }
}

async function main(): Promise<void> {
  const folder = path.join(scratch, 'made', 'on', 'the', 'way')
  const file = path.join(folder, 'a.json')
  await writeFileAtomic(file, '{"a":1}\n')
  eq(readFileSync(file, 'utf8'), '{"a":1}\n', 'the file is written, its folder made on the way')
  eq(readdirSync(folder), ['a.json'], 'and nothing else is left beside it')

  const temp = tempPath(file)
  check(path.dirname(temp) === folder && path.basename(temp).startsWith('.a.json.') && temp.endsWith('.tmp'), 'the temporary file is hidden, beside the target')
  check(tempPath(file) !== temp, 'and named afresh each time')

  await writeFileAtomic(file, Buffer.from('bytes'))
  eq(readFileSync(file, 'utf8'), 'bytes', 'bytes too, over the old file')

  const owner = path.join(scratch, 'owner.json')
  await writeFileAtomic(owner, 'secret', { ownerOnly: true })
  if (process.platform !== 'win32') eq(statSync(owner).mode & 0o777, 0o600, 'owner-only is mode 0600')
  else check(readFileSync(owner, 'utf8') === 'secret', 'owner-only is written (its ACL is checked in security.verify)')

  // ── A busy rename (Windows, a reader or scanner holding the file) ──
  const busy = failing('EBUSY', 2)
  await writeFileAtomic(file, 'after busy', { fs: { rename: busy.rename } })
  eq([readFileSync(file, 'utf8'), busy.calls()], ['after busy', 3], 'a busy rename is tried again until it goes through')

  const stuck = failing('EPERM', 1000)
  let error: unknown = null
  try {
    await writeFileAtomic(file, 'never', { fs: { rename: stuck.rename } })
  } catch (caught) {
    error = caught
  }
  eq((error as NodeJS.ErrnoException | null)?.code, 'EPERM', 'one that stays busy gives up with its error')
  eq(stuck.calls(), RENAME_TRIES, `after ${RENAME_TRIES} tries`)
  eq([readFileSync(file, 'utf8'), readdirSync(folder)], ['after busy', ['a.json']], 'leaving the old file as it was and no temporary file')

  const full = failing('ENOSPC', 1000)
  error = null
  try {
    await writeFileAtomic(file, 'never', { fs: { rename: full.rename } })
  } catch (caught) {
    error = caught
  }
  eq([(error as NodeJS.ErrnoException | null)?.code, full.calls()], ['ENOSPC', 1], 'any other error is not tried again')
  eq(readdirSync(folder), ['a.json'], 'and clears its temporary file too')

  // ── The write itself failing, half way ──
  error = null
  try {
    await writeFileAtomic(file, 'never', {
      fs: {
        writeFile: (async (target: string) => {
          writeFileSync(target, 'half')
          throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
        }) as never,
      },
    })
  } catch (caught) {
    error = caught
  }
  check(error !== null, 'a write that fails is passed on')
  eq([readFileSync(file, 'utf8'), readdirSync(folder)], ['after busy', ['a.json']], 'with the old file whole and the half-written one removed')

  rmSync(scratch, { recursive: true, force: true })
  done('atomic-write')
}

void main()
