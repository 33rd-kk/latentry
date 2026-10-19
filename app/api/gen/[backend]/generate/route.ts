import { adapterOr404, bodyTooLarge, jsonError, json, modeOf, readJson, toGenerateRequest } from '@/lib/api'
import { getCurrentJob, toSnapshot } from '@/lib/diffusion/job-store'
import { launchRun, type RunInput } from '@/lib/diffusion/launch'
import { enqueue, positionOf, pump, queueLength } from '@/lib/diffusion/run-queue'
import { getSaveDir, loraHashesEnabled } from '@/lib/gallery/dirs'
import { serverMessage } from '@/lib/i18n/core'
import { MAX_REQUEST_BODY_BYTES } from '@/lib/limits'
import { tryAcquire } from '@/lib/security/concurrency'
import { imageSize } from '@/lib/backends/images'
import { workflowAccess } from '@/lib/backends/workflow-access'
import { OUTPAINT_MAX_EDGE, outpaintSides } from '@/lib/generate/outpaint'
import { prepareOutpaint } from '@/lib/generate/outpaint-image'
import { hasWildcards } from '@/lib/wildcards/syntax'

export const runtime = 'nodejs'

/**
 * Starts a run and answers with its job id, or, while the backend is busy,
 * puts it in the queue and answers 202 with its place (run-queue.ts). The
 * backend's events are read here, on the server, into the job store — not
 * piped to whichever browser connection happened to ask — so a reload or a
 * backgrounded tab picks the run back up from .../job/stream instead of
 * losing it.
 */
export async function POST(request: Request, ctx: RouteContext<'/api/gen/[backend]/generate'>) {
  const adapter = adapterOr404((await ctx.params).backend)
  if (adapter instanceof Response) return adapter

  if (bodyTooLarge(request)) return jsonError(serverMessage('generate.tooLargeBody', { limit: MAX_REQUEST_BODY_BYTES / 1024 / 1024 }), 413)
  const body = await readJson(request)
  if (!body) return jsonError('Invalid JSON body', 400)
  const generate = toGenerateRequest(body)
  if (!generate) return jsonError('prompt is required', 400)
  // Only worked out when the pictures are saved with them (off by default).
  if (adapter.config.kind === 'diffusers' && loraHashesEnabled() && getSaveDir()) generate.lora_hashes = true
  // A backend that keeps traces of a run (ComfyUI) wipes them for a secret one.
  if (body.secret === true) generate.secret = true
  // Naming a workflow takes the same right as seeing the list of them.
  if (generate.workflow && !workflowAccess(request.headers, adapter.config)) {
    return jsonError('Workflows are not available to this device', 403)
  }

  const id = adapter.config.id
  // Extend: the source is padded and masked here, so the backend gets an
  // ordinary inpaint and needs to know nothing about outpainting. Done before
  // the run waits in the queue, so a bad source is refused now, not later.
  const sides = generate.init_image_base64 && !generate.upscale ? outpaintSides(body.outpaint) : null
  if (sides) {
    const prepared = await prepareOutpaint(generate.init_image_base64!, sides)
    if (!prepared) return jsonError(serverMessage('generate.outpaintInvalid', { max: OUTPAINT_MAX_EDGE }), 400)
    Object.assign(generate, { init_image_base64: prepared.image, mask_base64: prepared.mask, mask_blur: generate.mask_blur ?? 8, width: prepared.width, height: prepared.height })
    delete generate.pose_image_base64
    delete generate.pose_is_skeleton
    delete generate.pose_strength
  }
  // Only for the record: the backend is sent the prompt with its wildcards replaced.
  const template = body.prompt_template
  const input: RunInput = {
    generate,
    profile: typeof body.profile === 'string' ? body.profile : adapter.config.profile,
    mode: sides ? 'outpaint' : modeOf(generate),
    promptTemplate: typeof template === 'string' && template.length <= 10_000 && hasWildcards(template) ? template : undefined,
    // The record names an upscale's size before it, as hires fix's: the source's.
    sourceSize: generate.upscale && generate.init_image_base64 ? await imageSize(generate.init_image_base64) : null,
    secret: body.secret === true,
  }

  // The lock closes the gap between seeing the backend free and startJob
  // recording the run, which takes an await on the backend: without it two
  // requests inside that gap would both start, and the second would replace
  // the first's record, orphaning a run the GPU is still doing. A request
  // that finds it held, or a run going, or runs already waiting, joins the
  // queue instead.
  const release = tryAcquire(`gen:start:${id}`)
  if (!release || getCurrentJob(id)?.status === 'running' || queueLength(id) > 0) {
    release?.()
    return queueRun(id, input)
  }
  try {
    const started = await launchRun(adapter, input)
    if (started.ok) return json({ job: toSnapshot(started.value) })
    // Busy with a run this server did not start (another client on the web
    // UI): wait for it rather than refuse.
    if (started.status === 409) return queueRun(id, input)
    return jsonError(started.error, started.status)
  } finally {
    release?.()
  }
}

/**
 * Answers 202 with the waiting run's id and place. Only this answer carries
 * the id: the page that asked is the only one that may watch or cancel it.
 */
function queueRun(backend: string, input: RunInput): Response {
  const queued = enqueue(backend, input)
  if (!queued.ok) return jsonError(queued.error, queued.status)
  pump(backend)
  return json({ queued: { id: queued.value.id, position: positionOf(queued.value) } }, { status: 202 })
}
