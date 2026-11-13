import { randomInt } from 'node:crypto'
import { adapterOr404, bodyTooLarge, dropControl, jsonError, json, modeOf, readJson, toGenerateRequest } from '@/lib/api'
import { getAdapter } from '@/lib/backends'
import { getCurrentJob, toSnapshot } from '@/lib/diffusion/job-store'
import { isBusy, launchRun, type RunInput } from '@/lib/diffusion/launch'
import { enqueue, positionOf, pump, queueLength } from '@/lib/diffusion/run-queue'
import { freeMember, loadedModel, poolMembers } from '@/lib/diffusion/gpu-pool'
import { checkModelAxis, gridCells, gridErrorMessage, parseGrid, readGridInput, type GridSpec } from '@/lib/generate/grid'
import { getSaveDir, loraHashesEnabled } from '@/lib/gallery/dirs'
import { serverMessage } from '@/lib/i18n/core'
import { MAX_REQUEST_BODY_BYTES } from '@/lib/limits'
import { tryAcquire } from '@/lib/security/concurrency'
import { imageSize } from '@/lib/backends/images'
import { stripDataUrl } from '@/lib/backends/http'
import { DetectorMissingError, detectFaces } from '@/lib/facefix/detect'
import { squareSide, type FaceFixPlan } from '@/lib/facefix/run'
import { faceFixOptions } from '@/lib/generate/facefix'
import { workflowAccess } from '@/lib/backends/workflow-access'
import { OUTPAINT_MAX_EDGE, outpaintSides } from '@/lib/generate/outpaint'
import { prepareOutpaint } from '@/lib/generate/outpaint-image'
import { hasDynamicPrompt } from '@/lib/wildcards/syntax'
import { viewerOf } from '@/lib/security/viewer'

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
    dropControl(generate)
  }
  // Face fix: the faces are found here, before the run waits, so a picture
  // with none (or no detector downloaded yet) is answered now. The run then
  // redraws each face's crop as an ordinary inpaint (lib/facefix/run.ts).
  const fix = generate.init_image_base64 && !generate.upscale && !sides ? faceFixOptions(body.facefix) : null
  let facefix: FaceFixPlan | undefined
  if (fix) {
    if (body.grid !== undefined) return jsonError(serverMessage('generate.facefix.noGrid'), 400)
    const source = stripDataUrl(generate.init_image_base64!)
    const size = await imageSize(source)
    if (!size) return jsonError(serverMessage('generate.facefix.badPicture'), 400)
    let faces
    try {
      faces = await detectFaces(source, fix.detector, { confidence: fix.confidence, max: fix.maxFaces })
    } catch (error) {
      if (error instanceof DetectorMissingError) return jsonError(serverMessage('generate.facefix.noDetector'), 409)
      return jsonError(serverMessage('generate.facefix.badPicture'), 400)
    }
    if (faces.length === 0) return jsonError(serverMessage('generate.facefix.noFaces'), 400)
    facefix = { faces, options: fix, side: squareSide(generate.width, generate.height) }
    // The record names the picture as it comes back: the source's size, one picture, the denoise as strength.
    Object.assign(generate, { init_image_base64: source, strength: fix.denoise, image_count: 1, width: size.width, height: size.height })
    for (const key of ['mask_base64', 'mask_blur', 'pose_image_base64', 'pose_is_skeleton', 'pose_strength', 'workflow'] as const) delete generate[key]
    dropControl(generate)
  }
  // Only for the record: the backend is sent the prompt with its wildcards replaced.
  const template = body.prompt_template
  const input: RunInput = {
    generate,
    profile: typeof body.profile === 'string' ? body.profile : adapter.config.profile,
    mode: sides ? 'outpaint' : facefix ? 'facefix' : modeOf(generate),
    promptTemplate: typeof template === 'string' && template.length <= 10_000 && hasDynamicPrompt(template) ? template : undefined,
    // The record names an upscale's size before it, as hires fix's: the source's.
    sourceSize: generate.upscale && generate.init_image_base64 ? await imageSize(generate.init_image_base64) : null,
    secret: body.secret === true,
    startedBy: viewerOf(request.headers),
    ...(facefix ? { facefix } : {}),
  }
  // Any free GPU: with Latentry's engines on several GPUs, a run may be drawn
  // by another engine that is free and has the same model (gpu-pool.ts). An
  // X/Y grid and a face fix stay on the engine asked, start to end.
  if (body.any_gpu === true && body.grid === undefined && !facefix && poolMembers(id).length > 0) {
    const model = await loadedModel(id)
    if (model) input.anyGpu = { model }
  }

  // An X/Y grid always goes through the queue, as one run however many cells
  // it has; the queue starts its cells in turn.
  if (body.grid !== undefined) {
    const gridInput = readGridInput(body.grid)
    if (!gridInput) return jsonError(serverMessage('generate.grid.error.invalid'), 400)
    const parsed = parseGrid(gridInput, generate)
    if (!parsed.ok) return jsonError(gridErrorMessage(parsed.error), 400)
    // A model axis names checkpoints this backend must list, checked now so
    // a typo is refused before any cell runs.
    const spec = parsed.value
    if (spec.x.kind === 'model' || spec.y?.kind === 'model') {
      const models = checkModelAxis(spec, (await adapter.status()).checkpoints ?? [], Boolean(generate.workflow))
      if (models) return jsonError(gridErrorMessage(models), 400)
    }
    return queueGrid(id, input, spec)
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
    const elsewhere = input.anyGpu ? await startElsewhere(id, input) : null
    return elsewhere ?? queueRun(id, input)
  }
  try {
    const started = await launchRun(adapter, input)
    if (started.ok) return json({ job: toSnapshot(started.value) })
    // Busy with a run this server did not start (another client on the web
    // UI): wait for it rather than refuse. Any other 409 (the engine with no
    // model loaded) goes back to the page as it is.
    if (started.status === 409 && (await isBusy(adapter))) {
      const elsewhere = input.anyGpu ? await startElsewhere(id, input) : null
      return elsewhere ?? queueRun(id, input)
    }
    return jsonError(started.error, started.status)
  } finally {
    release?.()
  }
}

/**
 * Any free GPU, while the engine asked is busy: starts the run on another
 * engine of its pool that is free and has the same model, and answers as a
 * start on the engine asked would (the job names the engine drawing it).
 * Null when none is free, so the run waits in the queue instead.
 */
async function startElsewhere(asked: string, input: RunInput): Promise<Response | null> {
  const member = await freeMember(asked, input.anyGpu?.model ?? null, queueLength)
  const adapter = member ? getAdapter(member) : null
  if (!member || !adapter) return null
  const release = tryAcquire(`gen:start:${member}`)
  if (!release) return null
  try {
    if (getCurrentJob(member)?.status === 'running' || queueLength(member) > 0) return null
    const started = await launchRun(adapter, input)
    return started.ok ? json({ job: toSnapshot(started.value) }) : null
  } finally {
    release()
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

/**
 * Answers 202 as queueRun does, with the grid's axes as the server read them,
 * which is what the page lays its cells out by.
 */
function queueGrid(backend: string, input: RunInput, spec: GridSpec): Response {
  // One seed for every cell, so the setting is the only thing that changes,
  // unless the seed is what the grid changes.
  if (input.generate.seed === -1 && spec.x.kind !== 'seed' && spec.y?.kind !== 'seed') input.generate.seed = randomInt(0, 2 ** 32 - 1)
  const queued = enqueue(backend, input, { spec, cells: gridCells(spec) })
  if (!queued.ok) return jsonError(queued.error, queued.status)
  pump(backend)
  return json({ queued: { id: queued.value.id, position: positionOf(queued.value), grid: { ...spec, seed: input.generate.seed } } }, { status: 202 })
}
