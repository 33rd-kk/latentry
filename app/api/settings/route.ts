import { jsonError, json, readJson } from '@/lib/api'
import { editRefusal } from '@/lib/settings/access'
import { validateSettings, type SettingsErrors, type SettingsInput } from '@/lib/settings/schema'
import { checkDir, getSettings, saveSettings } from '@/lib/settings/store'
import { settingsView } from '@/lib/settings/view'
import { hasModel } from '@/lib/tagger/wd14'

export const runtime = 'nodejs'

/**
 * The settings in effect. Only for a client that may change them: the rest of
 * the network is told that it cannot, and not shown folder paths, backend
 * URLs or anything else it has no use for.
 */
export async function GET(request: Request) {
  const refusal = editRefusal(request.headers)
  if (refusal) return json({ editable: false, reason: refusal })
  return json(settingsView())
}

/**
 * Saves an edit. Each part sent replaces that part of the settings file;
 * `null` removes it, so it falls back to .env.local again; a part not sent is
 * kept. Applies at once, without a restart.
 */
export async function PUT(request: Request) {
  const refusal = editRefusal(request.headers)
  if (refusal) return jsonError(refusal === 'off' ? 'Settings are read-only (SETTINGS_EDIT=off)' : 'Settings can only be changed from this computer', 403)

  const body = await readJson(request)
  if (!body) return jsonError('Invalid JSON body', 400)
  const checked = validateSettings(body as SettingsInput, getSettings())
  if (!checked.ok) return json({ error: 'Some settings are not valid', errors: checked.errors }, { status: 422 })

  // Folders are checked here, where the file system is: the save folder must be
  // writable (it is created if missing), the others must exist.
  const errors: SettingsErrors = {}
  const gallery = checked.settings.gallery
  if (gallery?.saveDir) {
    const result = await checkDir(gallery.saveDir, { writable: true, create: true })
    if (result !== 'ok' && result !== 'created') errors['gallery.saveDir'] = `settings.dir.${result}`
  }
  for (const [index, dir] of (gallery?.dirs ?? []).entries()) {
    const result = await checkDir(dir)
    if (result !== 'ok') errors[`gallery.dirs.${index}`] = `settings.dir.${result}`
  }
  const modelDir = checked.settings.wd14?.modelDir
  if (modelDir && !hasModel(modelDir)) errors['wd14.modelDir'] = 'settings.wd14Missing'
  if (Object.keys(errors).length) return json({ error: 'Some folders cannot be used', errors }, { status: 422 })

  try {
    await saveSettings(checked.settings)
  } catch (error) {
    console.error('Saving settings failed:', error)
    return jsonError('Could not write the settings file', 500)
  }
  return json(settingsView(checked.settings))
}
