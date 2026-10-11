import { json } from '@/lib/api'
import { engineFetch, engines } from '@/lib/engine/supervisor'
import { loraAccess } from '@/lib/engine/lora-access'
import { getSettings } from '@/lib/settings/store'

export const runtime = 'nodejs'

interface EngineLora {
  name: string
  /** The model family it was made for; null when the engine could not tell. */
  family: string | null
  /** The licence its file names, if any, for the picker to show. */
  license: string | null
}

/**
 * The LoRAs in the models folder's loras folder, for the LoRA picker on the
 * generate page. Names only, never paths. The names are the user's own files,
 * so by default only for a client that may change the engine; with
 * "Show LoRAs on paired devices" (settings.engine.shareLoras) for any client
 * that got past pairing too (see lib/engine/lora-access.ts).
 *
 *   GET ?probe=1   { editable, shared, engines }  whether this client gets a picker, and on which backends; no names
 *   GET            { editable, shared, loras }    the list, asked for when the picker opens
 */
export async function GET(request: Request) {
  const access = loraAccess(request.headers, getSettings())
  if (!access) return json({ editable: false, shared: false })
  const flags = { editable: access === 'edit', shared: access === 'shared' }
  if (new URL(request.url).searchParams.get('probe') === '1') return json({ ...flags, engines: engines().map((engine) => engine.id) })

  const running = engines().find((engine) => engine.state === 'running')
  if (!running) return json({ ...flags, loras: [] })
  try {
    const list = await engineFetch(running, '/api/loras').then((response) => response.json())
    const loras: EngineLora[] = (Array.isArray(list?.loras) ? list.loras : [])
      .filter((lora: { name?: unknown }) => typeof lora?.name === 'string' && lora.name)
      .map((lora: { name: string; family?: unknown; license?: unknown }) => ({
        name: lora.name,
        family: typeof lora.family === 'string' ? lora.family : null,
        license: typeof lora.license === 'string' ? lora.license : null,
      }))
    return json({ ...flags, loras })
  } catch {
    return json({ ...flags, loras: null })
  }
}
