import { bodyTooLarge, jsonError, json, readJson } from '@/lib/api'
import { stripDataUrl } from '@/lib/backends/http'
import { AnnotatorMissingError, CONTROL_KINDS, controlPicture, type ControlKind } from '@/lib/control/annotators'
import { serverMessage } from '@/lib/i18n/core'
import { MAX_REQUEST_BODY_BYTES } from '@/lib/limits'
import { tryEnter } from '@/lib/security/concurrency'

export const runtime = 'nodejs'

// One is made when a reference is dropped in or a setting changes; two at
// once covers a quick second change, more is a flood.
const MAX_AT_ONCE = 2

/**
 * The control picture a reference makes, for the page to show and send with
 * a run: Canny edges, a depth map or line art, made here on the CPU.
 *
 *   POST { kind: 'canny' | 'depth' | 'lineart', image_base64, low?, high? }
 *   → { image_base64 (PNG), width, height }
 *
 * Nothing is written: the reference and the control picture live only in this
 * request and in the page that asked.
 */
export async function POST(request: Request) {
  if (bodyTooLarge(request)) return jsonError(serverMessage('generate.tooLargeBody', { limit: MAX_REQUEST_BODY_BYTES / 1024 / 1024 }), 413)
  const release = tryEnter('control:picture', MAX_AT_ONCE)
  if (!release) return jsonError(serverMessage('generate.control.busy'), 409)
  try {
    const body = await readJson(request)
    const kind = body?.kind
    if (typeof kind !== 'string' || !(CONTROL_KINDS as readonly string[]).includes(kind)) return jsonError('kind must be canny, depth or lineart', 400)
    if (typeof body?.image_base64 !== 'string' || !body.image_base64) return jsonError('image_base64 is required', 400)
    const picture = Buffer.from(stripDataUrl(body.image_base64), 'base64')
    let made: Buffer
    try {
      made = await controlPicture(kind as ControlKind, picture, {
        low: typeof body.low === 'number' ? body.low : undefined,
        high: typeof body.high === 'number' ? body.high : undefined,
      })
    } catch (error) {
      if (error instanceof AnnotatorMissingError) return jsonError(serverMessage('generate.control.missing', { kind }), 409)
      return jsonError(serverMessage('generate.control.badPicture'), 400)
    }
    const { default: sharp } = await import('sharp')
    const meta = await sharp(made).metadata()
    return json({ image_base64: made.toString('base64'), width: meta.width, height: meta.height })
  } finally {
    release()
  }
}
