import { json } from '@/lib/api'
import { engineFetch, engines } from '@/lib/engine/supervisor'
import { editRefusal } from '@/lib/settings/access'

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
 * generate page. Names only, never paths. Like the model list, only for a
 * client that may change the engine: the names are the user's own files.
 */
export async function GET(request: Request) {
  if (editRefusal(request.headers)) return json({ editable: false })
  const running = engines().find((engine) => engine.state === 'running')
  if (!running) return json({ editable: true, loras: [] })
  try {
    const list = await engineFetch(running, '/api/loras').then((response) => response.json())
    const loras: EngineLora[] = (Array.isArray(list?.loras) ? list.loras : [])
      .filter((lora: { name?: unknown }) => typeof lora?.name === 'string' && lora.name)
      .map((lora: { name: string; family?: unknown; license?: unknown }) => ({
        name: lora.name,
        family: typeof lora.family === 'string' ? lora.family : null,
        license: typeof lora.license === 'string' ? lora.license : null,
      }))
    return json({ editable: true, loras })
  } catch {
    return json({ editable: true, loras: null })
  }
}
