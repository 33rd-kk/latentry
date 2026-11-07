// Face fix as one run: each face's crop is sent to the backend as an
// ordinary inpaint, one after another, and pasted back into the picture
// before the next is cut out. The backend knows nothing of it; the page sees
// one run with one picture, its steps counted across the faces.

import type { BackendAdapter, BackendEvent, GenerateRequest, Outcome } from '@/lib/backends/types'
import type { LoraUse } from '@/lib/image-meta'
import type { FaceFixOptions } from '@/lib/generate/facefix'
import type { FaceBox } from './decode'
import { canvasOf, canvasPng, cropFor, cropPng, maskPng, pasteFace, type Canvas } from './image'

/** What the route found, kept with the run while it waits. */
export interface FaceFixPlan {
  faces: FaceBox[]
  options: FaceFixOptions
  /** The side each face's crop is drawn at: about the form's size, so a small face gets the backend's full resolution. */
  side: number
}

interface Active {
  runId: string | null
  cancelled: boolean
  inner: BackendAdapter
}

// The face fix going on each backend, for the cancel route: it stops the
// face being drawn and the ones after it.
const globalForRuns = globalThis as typeof globalThis & { __latentryFaceFix?: Map<string, Active> }
const active = (globalForRuns.__latentryFaceFix ??= new Map())

/** Stops the face fix going on a backend, if one is; null when none is. */
export async function cancelFaceFix(backendId: string): Promise<Outcome<{ status: string }> | null> {
  const run = active.get(backendId)
  if (!run) return null
  run.cancelled = true
  if (run.runId) {
    const result = await run.inner.cancel(run.runId)
    if (!result.ok && result.status !== 409) return result
  }
  return { ok: true, value: { status: 'cancelling' } }
}

/** A square side of about the form's area, on the 8-pixel grid every backend takes. */
export function squareSide(width: number, height: number): number {
  return Math.max(256, Math.min(2048, Math.round(Math.sqrt(width * height) / 8) * 8))
}

function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 32)
}

/** The backend, wrapped so that a run of it is a face fix of `request`'s source. */
export function faceFixAdapter(inner: BackendAdapter, plan: FaceFixPlan): BackendAdapter {
  return {
    config: inner.config,
    status: () => inner.status(),
    presets: () => inner.presets(),
    cancel: (runId) => inner.cancel(runId),
    ...(inner.markSecret ? { markSecret: () => inner.markSecret!() } : {}),
    async start(request: GenerateRequest): Promise<Outcome<AsyncIterable<BackendEvent>>> {
      if (!request.init_image_base64) return { ok: false, status: 400, error: 'Face fix needs a picture' }
      if (active.has(inner.config.id)) return { ok: false, status: 409, error: 'A face fix is already going on this backend' }
      const run: Active = { runId: null, cancelled: false, inner }
      active.set(inner.config.id, run)
      // The first face starts now, so a backend that refuses is answered as for any run.
      let canvas: Canvas
      try {
        canvas = await canvasOf(request.init_image_base64)
      } catch {
        active.delete(inner.config.id)
        return { ok: false, status: 400, error: 'Face fix could not read the picture' }
      }
      const seed = request.seed >= 0 ? request.seed : randomSeed()
      const side = plan.side
      const crops = plan.faces.map((face) => cropFor(face, canvas.width, canvas.height))
      const faceRequest = async (index: number): Promise<GenerateRequest> => ({
        ...request,
        prompt: plan.options.prompt || request.prompt,
        init_image_base64: await cropPng(canvas, crops[index]),
        mask_base64: await maskPng(crops[index]),
        mask_blur: 4,
        strength: plan.options.denoise,
        width: side,
        height: side,
        seed: (seed + index) % 2 ** 32,
        image_count: 1,
      })
      const first = await inner.start(await faceRequest(0))
      if (!first.ok) {
        active.delete(inner.config.id)
        return first
      }

      async function* events(): AsyncGenerator<BackendEvent> {
        let stepsPerFace = 0
        let loras: LoraUse[] | undefined
        try {
          for (let index = 0; index < crops.length; index += 1) {
            if (run.cancelled) {
              yield { type: 'cancelled' }
              return
            }
            const started = index === 0 ? first : await inner.start(await faceRequest(index))
            if (!started.ok) {
              yield { type: 'error', message: started.error }
              return
            }
            let redrawn: string | null = null
            for await (const event of started.value) {
              if (event.type === 'start') {
                run.runId = event.runId ?? run.runId
                stepsPerFace = event.steps || stepsPerFace
                yield { type: 'start', index: 0, total: 1, steps: stepsPerFace * crops.length, ...(event.runId ? { runId: event.runId } : {}) }
                if (index > 0) yield { type: 'step', index: 0, step: stepsPerFace * index }
              } else if (event.type === 'step') {
                yield { type: 'step', index: 0, step: stepsPerFace * index + event.step }
              } else if (event.type === 'image') {
                redrawn = event.imageBase64
                loras = event.loras ?? loras
              } else if (event.type === 'cancelled' || event.type === 'error') {
                yield event
                return
              }
            }
            if (run.cancelled) {
              yield { type: 'cancelled' }
              return
            }
            if (!redrawn) {
              yield { type: 'error', message: 'The backend sent no picture for a face' }
              return
            }
            await pasteFace(canvas, crops[index], redrawn)
          }
          yield { type: 'image', index: 0, total: 1, seed, imageBase64: await canvasPng(canvas), ...(loras?.length ? { loras } : {}) }
          yield { type: 'done' }
        } finally {
          active.delete(inner.config.id)
        }
      }
      return { ok: true, value: events() }
    },
  }
}
