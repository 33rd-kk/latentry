import { jsonError, json, readJson } from '@/lib/api'
import { errorMessage } from '@/lib/backends/http'
import { catalogEntry } from '@/lib/engine/catalog'
import { HfLookupError, resolveHfFile } from '@/lib/engine/hf-resolve'
import { parseHfFileUrl } from '@/lib/engine/hf-url'
import { engineFetch, engines } from '@/lib/engine/supervisor'
import { startTaggerDownload } from '@/lib/engine/tagger-download'
import { serverMessage } from '@/lib/i18n/core'
import { editRefusal } from '@/lib/settings/access'

export const runtime = 'nodejs'

const COMMIT = /^[0-9a-f]{40}$/

/**
 * Downloads a model: { id } from the catalog, or { url, revision, folder } for
 * one .safetensors file the user named by its Hugging Face URL. Either way the
 * engine fetches a fixed commit and keeps the file only if it matches its
 * SHA-256. For a URL, the revision is the commit the page was shown (from
 * ../hf), and the hash is looked up again here, never taken from the page.
 * Checkpoints and LoRAs are fetched by the engine into its models folder;
 * taggers by Latentry itself.
 */
export async function POST(request: Request) {
  if (editRefusal(request.headers)) return jsonError('Only from this computer', 403)
  const body = await readJson(request)
  if (typeof body?.url === 'string') return downloadUrl(body)
  const entry = typeof body?.id === 'string' ? catalogEntry(body.id) : null
  if (!entry) return jsonError('Not in the catalog', 404)

  if (entry.kind === 'tagger') return json(startTaggerDownload(entry), { status: 202 })

  return startOnEngine({
    repo_id: entry.repo,
    revision: entry.revision,
    filename: entry.filename ?? null,
    sha256: entry.filename ? (entry.sha256?.[entry.filename] ?? null) : null,
  })
}

async function downloadUrl(body: Record<string, unknown>): Promise<Response> {
  const parsed = parseHfFileUrl(body.url as string)
  if (!parsed.ok) return jsonError(serverMessage(parsed.error), 400)
  if (typeof body.revision !== 'string' || !COMMIT.test(body.revision)) return jsonError(serverMessage('setup.hf.error.revision'), 400)
  if (body.folder !== 'checkpoint' && body.folder !== 'lora') return jsonError('folder is checkpoint or lora', 400)
  if (!runningEngine()) return jsonError(serverMessage('setup.needEngine'), 409)
  let file
  try {
    file = await resolveHfFile({ ...parsed, revision: body.revision })
  } catch (error) {
    if (error instanceof HfLookupError) return jsonError(serverMessage(error.key), error.status)
    throw error
  }
  return startOnEngine({
    repo_id: file.repo,
    revision: file.commit,
    filename: file.path,
    sha256: file.sha256,
    folder: body.folder === 'lora' ? 'loras' : '',
    size: file.size,
  })
}

function runningEngine() {
  return engines().find((candidate) => candidate.state === 'running')
}

async function startOnEngine(download: Record<string, unknown>): Promise<Response> {
  const engine = runningEngine()
  if (!engine) return jsonError('Start the engine first: it downloads the models', 409)
  const response = await engineFetch(engine, '/api/models/download', { method: 'POST', body: JSON.stringify(download) })
  const payload = await response.json().catch(() => null)
  return response.ok ? json(payload, { status: 202 }) : jsonError(errorMessage(payload, 'The engine refused the download'), response.status)
}
