import { jsonError, json, readJson } from '@/lib/api'
import { dirFor } from '@/lib/gallery/access'
import { resolveInDir } from '@/lib/gallery/fs'
import { NewerRatingsError, setRating, TooManyRatingsError, validStars } from '@/lib/gallery/ratings'

export const runtime = 'nodejs'

/**
 * Gives a picture 1–5 stars, or takes its rating away with 0. Kept in
 * latentry.ratings.json, never in the picture, so pictures in read-only
 * folders can be rated too. Any paired device may rate, as it may browse.
 */
export async function PUT(request: Request, ctx: RouteContext<'/api/gallery/[dir]/[name]/rating'>) {
  const { dir: dirParam, name } = await ctx.params
  const dir = dirFor(request.headers, dirParam)
  if (!dir) return jsonError('Not found', 404)

  const body = await readJson(request)
  const stars = body?.stars === 0 ? 0 : validStars(body?.stars)
  if (stars === null) return jsonError('stars must be a whole number from 0 to 5', 400)
  // Only a picture that is there, so the file never holds names made up from outside.
  if (!(await resolveInDir(dir, name))) return jsonError('Not found', 404)

  try {
    await setRating(dir.path, name, stars)
    return json({ stars })
  } catch (error) {
    if (error instanceof NewerRatingsError) return jsonError('The ratings were saved by a newer Latentry', 409)
    if (error instanceof TooManyRatingsError) return jsonError(error.message, 409)
    console.error('[ratings] could not save:', error instanceof Error ? error.message : error)
    return jsonError('Could not save the rating', 500)
  }
}
