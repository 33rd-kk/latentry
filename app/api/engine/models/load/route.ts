import { jsonError, json, readJson } from '@/lib/api'
import { engineFetch, engines } from '@/lib/engine/supervisor'
import { editRefusal } from '@/lib/settings/access'
import { getSettings, NewerSettingsError, saveSettings } from '@/lib/settings/store'

export const runtime = 'nodejs'

/**
 * Loads a model from the models folder on every engine: { id }. It is also
 * remembered, so the engines load it again when they next start.
 */
export async function POST(request: Request) {
  if (editRefusal(request.headers)) return jsonError('Only from this computer', 403)
  const body = await readJson(request)
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!id || id.length > 200 || /[\\/]|\.\./.test(id)) return jsonError('A model id from the models folder', 400)

  const running = engines().filter((engine) => engine.state === 'running')
  if (!running.length) return jsonError('No engine is running', 409)
  const results = await Promise.all(
    running.map(async (engine) => {
      const response = await engineFetch(engine, '/api/models/load', { method: 'POST', body: JSON.stringify({ id }) })
      const payload = await response.json().catch(() => null)
      return { engine: engine.id, ok: response.ok, error: response.ok ? null : (payload?.detail ?? `HTTP ${response.status}`) }
    })
  )
  const failed = results.find((result) => !result.ok)
  if (failed) return jsonError(String(failed.error), 422, { results })

  const settings = getSettings()
  try {
    await saveSettings({ ...settings, engine: { ...settings.engine, model: id } })
  } catch (error) {
    // The model is loading either way; only remembering it for the next start is skipped.
    if (!(error instanceof NewerSettingsError)) throw error
    console.warn(`[settings] not remembering the engine model: ${error.message}`)
  }
  return json({ status: 'loading', results }, { status: 202 })
}
