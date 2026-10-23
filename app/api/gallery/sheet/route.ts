import { jsonError, json, readJson } from '@/lib/api'
import { getSaveDir } from '@/lib/gallery/dirs'
import { saveSheet } from '@/lib/gallery/save'
import { buildSheet, readSheetLayout } from '@/lib/gallery/sheet'
import { serverMessage } from '@/lib/i18n/core'
import { tryAcquire } from '@/lib/security/concurrency'

export const runtime = 'nodejs'

/**
 * Saves an X/Y grid's sheet: its cells in one picture, in the save folder.
 *
 *   POST { grid: string, rows: (string | null)[][], secret?: boolean }
 *
 * `rows` names the cells' saved pictures, X across and Y down. Only pictures
 * in the save folder whose own record names this grid are used, and the
 * headings come from those records, not from the request. Never in secret
 * mode: the page does not offer it there, and the server says no as well.
 */
export async function POST(request: Request) {
  const body = await readJson(request)
  if (body?.secret === true) return jsonError(serverMessage('generate.grid.error.sheetSecret'), 403)
  const layout = readSheetLayout(body)
  if (!layout) return jsonError(serverMessage('generate.grid.error.sheetInvalid'), 400)
  const dir = getSaveDir()
  if (!dir) return jsonError(serverMessage('generate.grid.error.sheetNoFolder'), 409)

  // One at a time: each holds up to 64 full-size pictures in memory while it is built.
  const release = tryAcquire('gallery:sheet')
  if (!release) return jsonError(serverMessage('generate.grid.error.sheetBusy'), 429)
  try {
    const sheet = await buildSheet(dir, layout)
    if (!sheet) return jsonError(serverMessage('generate.grid.error.sheetInvalid'), 400)
    return json({ name: await saveSheet(dir, sheet.png, sheet.record) })
  } catch (error) {
    console.error('Saving the sheet failed:', error)
    return jsonError(serverMessage('generate.grid.error.sheetFailed'), 500)
  } finally {
    release()
  }
}
