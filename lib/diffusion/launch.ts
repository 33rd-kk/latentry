import { backendStatus } from '@/lib/api'
import type { BackendAdapter, GenerateRequest, Outcome } from '@/lib/backends/types'
import { consumeEvents, startJob, type Job, type JobContext } from '@/lib/diffusion/job-store'
import { hiresSteps } from '@/lib/diffusion/hires'
import { img2imgSteps } from '@/lib/diffusion/img2img'
import { saveToGallery } from '@/lib/gallery/save'

/**
 * A run as the generate route accepted it: checked, and with Extend's padding
 * already done, so starting it later (from the queue) cannot fail on the
 * request itself — only on the backend.
 */
export interface RunInput {
  generate: GenerateRequest
  profile: string
  mode: JobContext['mode']
  /** The prompt as typed, with its wildcards, when the page replaced any. */
  promptTemplate?: string
  /** An upscale's record names the source's size, as hires fix's does. */
  sourceSize?: { width: number; height: number } | null
  secret: boolean
}

/** Roughly how much memory the run's pictures hold while it waits. */
export function inputBytes(input: RunInput): number {
  const { init_image_base64, mask_base64, pose_image_base64 } = input.generate
  return (init_image_base64?.length ?? 0) + (mask_base64?.length ?? 0) + (pose_image_base64?.length ?? 0)
}

/**
 * Hands the run to the backend and records it as the backend's current job.
 * `id` keeps the id a queued run was given, so a page watching it while it
 * waited goes on watching the same id once it runs.
 */
export async function launchRun(adapter: BackendAdapter, input: RunInput, id?: string): Promise<Outcome<Job>> {
  const { generate } = input
  if (input.secret) generate.secret = true
  const status = await backendStatus(adapter, 30 * 1000).catch(() => null)
  const started = await adapter.start(generate)
  if (!started.ok) return started

  // An upscale runs only its redraw; hires fix both passes.
  const steps = generate.upscale
    ? hiresSteps(generate)
    : generate.init_image_base64
      ? img2imgSteps(generate.num_inference_steps, generate.strength ?? 0.6, input.profile)
      : generate.num_inference_steps + hiresSteps(generate)
  const job = startJob({
    id,
    backend: adapter.config.id,
    total: generate.image_count,
    steps,
    secret: input.secret,
    context: {
      // The settings without the pictures: the record only needs to say a
      // source was used (strength is set exactly when one was), and the
      // base64 would sit in memory for as long as the job does.
      request: { ...generate, ...(input.sourceSize ?? {}), init_image_base64: undefined, mask_base64: undefined, pose_image_base64: undefined },
      profile: input.profile,
      kind: adapter.config.kind,
      // A workflow loads its own model unless one is set for the backend; status cannot say which.
      model: generate.workflow && !adapter.config.model ? null : (status?.model ?? null),
      mode: input.mode,
      ...(input.promptTemplate ? { promptTemplate: input.promptTemplate } : {}),
    },
  })

  // Not awaited: this outlives the request that started it, which is what
  // lets the run survive the browser navigating away.
  void consumeEvents(job, started.value, saveToGallery)
  return { ok: true, value: job }
}

/**
 * True when the backend says it is busy with a run. A refusal with 409 means
 * that on a web UI or ComfyUI, but Latentry's engine also answers 409 when no
 * model is loaded; the queue waits only for the first.
 */
export async function isBusy(adapter: BackendAdapter): Promise<boolean> {
  return (await adapter.status().catch(() => null))?.busy === true
}
