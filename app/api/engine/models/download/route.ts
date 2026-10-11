import { jsonError, json, readJson } from '@/lib/api'
import { catalogEntry } from '@/lib/engine/catalog'
import { engineFetch, engines } from '@/lib/engine/supervisor'
import { startTaggerDownload } from '@/lib/engine/tagger-download'
import { editRefusal } from '@/lib/settings/access'

export const runtime = 'nodejs'

/**
 * Downloads a model from the catalog: { id }. Only catalog entries, so this
 * cannot be pointed at an arbitrary repository. Checkpoints are fetched by the
 * engine into its models folder; taggers by Latentry itself.
 */
export async function POST(request: Request) {
  if (editRefusal(request.headers)) return jsonError('Only from this computer', 403)
  const body = await readJson(request)
  const entry = typeof body?.id === 'string' ? catalogEntry(body.id) : null
  if (!entry) return jsonError('Not in the catalog', 404)

  if (entry.kind === 'tagger') return json(startTaggerDownload(entry), { status: 202 })

  const engine = engines().find((candidate) => candidate.state === 'running')
  if (!engine) return jsonError('Start the engine first: it downloads the models', 409)
  const response = await engineFetch(engine, '/api/models/download', {
    method: 'POST',
    body: JSON.stringify({
      repo_id: entry.repo,
      revision: entry.revision,
      filename: entry.filename ?? null,
      sha256: entry.filename ? (entry.sha256?.[entry.filename] ?? null) : null,
    }),
  })
  const payload = await response.json().catch(() => null)
  return response.ok ? json(payload, { status: 202 }) : jsonError(payload?.detail ?? 'The engine refused the download', response.status)
}
