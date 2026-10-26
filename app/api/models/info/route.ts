import { jsonError, json, readJson } from '@/lib/api'
import { serverMessage } from '@/lib/i18n/core'
import { modelKey, modelName, NewerModelInfoError, readModelInfo, saveModelInfo, TooManyModelsError, validateModelInfo } from '@/lib/models/info'
import { editRefusal } from '@/lib/settings/access'

export const runtime = 'nodejs'

// Model names and their links say what is on this computer, so reading them
// is limited like changing them: this machine and owner devices only.
function refused(request: Request): Response | null {
  const refusal = editRefusal(request.headers)
  if (!refusal) return null
  return jsonError(refusal === 'off' ? 'Settings are read-only (SETTINGS_EDIT=off)' : 'Only from this computer', 403)
}

/** `?name=`: that model's info, or null. Without it: every model's, by key. */
export async function GET(request: Request) {
  const refusal = refused(request)
  if (refusal) return refusal
  const raw = new URL(request.url).searchParams.get('name')
  const models = readModelInfo()
  if (raw === null) return json({ models })
  const key = modelKey(raw)
  if (!key) return jsonError('A model file name', 400)
  return json({ info: models[key] ?? null })
}

/** Keeps a model's info: { name, info }. What is left out of `info` is not kept. */
export async function PUT(request: Request) {
  const refusal = refused(request)
  if (refusal) return refusal
  const body = await readJson(request)
  if (!body) return jsonError('Invalid JSON body', 400)
  const name = modelName(body.name)
  const key = modelKey(body.name)
  if (!name || !key) return jsonError('A model file name', 400)
  if (!body.info || typeof body.info !== 'object' || Array.isArray(body.info)) return jsonError('Invalid JSON body', 400)
  const checked = validateModelInfo(body.info as Record<string, unknown>, name)
  if (checked.errors) return json({ error: 'Some values are not valid', errors: checked.errors }, { status: 422 })
  return save(key, checked.info, () => json({ info: checked.info }))
}

/** `?name=`: forgets that model's info. */
export async function DELETE(request: Request) {
  const refusal = refused(request)
  if (refusal) return refusal
  const key = modelKey(new URL(request.url).searchParams.get('name'))
  if (!key) return jsonError('A model file name', 400)
  return save(key, null, () => json({ info: null }))
}

async function save(key: string, info: Parameters<typeof saveModelInfo>[1], ok: () => Response): Promise<Response> {
  try {
    await saveModelInfo(key, info)
  } catch (error) {
    if (error instanceof NewerModelInfoError) return jsonError(serverMessage('modelInfo.newerFile', { version: error.version }), 409)
    if (error instanceof TooManyModelsError) return jsonError(serverMessage('modelInfo.tooMany'), 409)
    console.error('Saving model info failed:', error instanceof Error ? error.message : error)
    return jsonError('Could not write the model info file', 500)
  }
  return ok()
}
