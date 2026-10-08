import { NextResponse } from 'next/server'
import { adapterOr404, backendStatus, bodyTooLarge, jsonError, json, modeOf, readJson, toGenerateRequest } from '@/lib/api'
import { img2imgSteps } from '@/lib/diffusion/img2img'
import { consumeEvents, getCurrentJob, startJob, toSnapshot } from '@/lib/diffusion/job-store'
import { saveToGallery } from '@/lib/gallery/save'
import { serverMessage } from '@/lib/i18n/core'
import { MAX_REQUEST_BODY_BYTES } from '@/lib/limits'
import { tryAcquire } from '@/lib/security/concurrency'

export const runtime = 'nodejs'

/**
 * Starts a run and answers with its job id. The backend's events are read
 * here, on the server, into the job store — not piped to whichever browser
 * connection happened to ask — so a reload or a backgrounded tab picks the run
 * back up from .../job/stream instead of losing it.
 */
export async function POST(request: Request, ctx: RouteContext<'/api/gen/[backend]/generate'>) {
  const adapter = adapterOr404((await ctx.params).backend)
  if (adapter instanceof NextResponse) return adapter

  if (bodyTooLarge(request)) return jsonError(serverMessage('generate.tooLargeBody', { limit: MAX_REQUEST_BODY_BYTES / 1024 / 1024 }), 413)
  const body = await readJson(request)
  if (!body) return jsonError('Invalid JSON body', 400)
  const generate = toGenerateRequest(body)
  if (!generate) return jsonError('prompt is required', 400)

  const id = adapter.config.id
  // A backend does one run at a time, so a second request would only queue
  // behind the first while its progress went unwatched. Hand back the running
  // job instead — a page that reloaded and pressed Generate again reattaches.
  // A secret run's id is not handed out: only the page that started it may watch it.
  const running = getCurrentJob(id)
  if (running?.status === 'running') {
    return json({ error: 'A generation is already running', ...(running.secret ? {} : { job: toSnapshot(running) }) }, { status: 409 })
  }

  // The check above only sees a run once startJob has recorded it, and that
  // takes an await on the backend. Without this lock two requests inside that
  // gap both pass, and the second replaces the first's record — orphaning a
  // run the GPU is still doing.
  const release = tryAcquire(`gen:start:${id}`)
  if (!release) return jsonError(serverMessage('system.busyStarting'), 409)
  try {
    const status = await backendStatus(adapter, 30 * 1000).catch(() => null)
    const started = await adapter.start(generate)
    // No `job` on this 409: the backend is busy with a run this server did not
    // start, so there is nothing to reattach to.
    if (!started.ok) return jsonError(started.error, started.status)

    const profile = typeof body.profile === 'string' ? body.profile : adapter.config.profile
    const steps = generate.init_image_base64
      ? img2imgSteps(generate.num_inference_steps, generate.strength ?? 0.6, profile)
      : generate.num_inference_steps
    const job = startJob({
      backend: id,
      total: generate.image_count,
      steps,
      secret: body.secret === true,
      context: {
        // The settings without the pictures: the record only needs to say a
        // source was used (strength is set exactly when one was), and the
        // base64 would sit in memory for as long as the job does.
        request: { ...generate, init_image_base64: undefined, mask_base64: undefined, pose_image_base64: undefined },
        profile,
        kind: adapter.config.kind,
        model: status?.model ?? null,
        mode: modeOf(generate),
      },
    })

    // Not awaited: this outlives the request that started it, which is what
    // lets the run survive the browser navigating away.
    void consumeEvents(job, started.value, saveToGallery)
    return json({ job: toSnapshot(job) })
  } finally {
    release()
  }
}
