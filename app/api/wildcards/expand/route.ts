import { jsonError, json, readJson } from '@/lib/api'
import { serverMessage } from '@/lib/i18n/core'
import { getSettings } from '@/lib/settings/store'
import { wildcardsAccess } from '@/lib/wildcards/access'
import { expandWildcards, WildcardError } from '@/lib/wildcards/expand'
import { readWildcard } from '@/lib/wildcards/folder'

export const runtime = 'nodejs'

const MAX_TEXT_CHARS = 10_000

/**
 * Replaces the wildcards in a prompt and its negative prompt, once for the
 * run about to start: `{ prompt, negative_prompt, seed }` →
 * `{ prompt, negative_prompt }`. The page does this before it respells the
 * tags for the profile, so the lines it gets back are respelled too. With a
 * seed of 0 or more the same lines are picked again for that seed. Neither
 * the prompt nor the lines are kept or logged.
 */
export async function POST(request: Request) {
  const settings = getSettings()
  const access = wildcardsAccess(request.headers, settings)
  if (!access) return jsonError(serverMessage('generate.wildcards.notShared'), 403)
  const dir = settings.wildcards?.dir
  if (!dir) return jsonError(serverMessage('generate.wildcards.noFolder'), 409)

  const body = await readJson(request)
  const prompt = typeof body?.prompt === 'string' ? body.prompt : null
  const negative = typeof body?.negative_prompt === 'string' ? body.negative_prompt : ''
  const seed = typeof body?.seed === 'number' && Number.isInteger(body.seed) && body.seed >= -1 ? body.seed : -1
  if (prompt === null || prompt.length > MAX_TEXT_CHARS || negative.length > MAX_TEXT_CHARS) return jsonError('Invalid JSON body', 400)

  try {
    const { texts } = await expandWildcards([prompt, negative], seed, (name) => readWildcard(dir, name))
    return json({ prompt: texts[0], negative_prompt: texts[1] })
  } catch (error) {
    if (error instanceof WildcardError) return jsonError(serverMessage(`generate.wildcards.${error.problem}`, { name: `__${error.wildcard}__` }), 400)
    throw error
  }
}
