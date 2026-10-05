import { json } from '@/lib/api'
import { engineFetch, engines, profileFor } from '@/lib/engine/supervisor'
import { editRefusal } from '@/lib/settings/access'

export const runtime = 'nodejs'

/**
 * The models in the models folder that the engines can load, for the model
 * picker on the generate page: only what is on disk, never the catalog. Like
 * loading one, only for a client that may change the engine.
 */
export async function GET(request: Request) {
  if (editRefusal(request.headers)) return json({ editable: false })
  const running = engines().filter((engine) => engine.state === 'running')
  const base = { editable: true, engines: running.map((engine) => engine.id) }
  if (!running.length) return json({ ...base, models: [], current: null, loading: null, loadError: null })

  try {
    const list = await engineFetch(running[0], '/api/models').then((response) => response.json())
    const models = (list.models as { id: string; name: string; family: string | null }[])
      .filter((model) => model.family)
      .map((model) => ({ id: model.id, name: model.name, family: model.family, profile: profileFor(model.id, model.family) }))
    return json({
      ...base,
      models,
      current: typeof list.current === 'string' ? list.current : null,
      loading: typeof list.loading === 'string' ? list.loading : null,
      loadError: typeof list.load_error === 'string' ? list.load_error : null,
    })
  } catch {
    // Busy starting a load; the next poll will have it.
    return json({ ...base, models: null, current: null, loading: null, loadError: null })
  }
}
