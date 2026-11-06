// A stand-in for stable-diffusion.cpp's sd-server, for tests that run a whole
// generation without a GPU: the few /sdcpp/v1 calls lib/backends/sdcpp.ts
// makes. Each job takes a few polls (queued, two steps, done) and answers
// with a small real PNG; one whose prompt has SDCPP_HOLD stays at its first
// step until it is cancelled. GET /mock/cancelled lists the jobs cancelled,
// for a browser test in another process. Like the other mocks, it knows nothing about Latentry.

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import sharp from 'sharp'

export interface MockSdcpp {
  /** Base URL, with a trailing slash, as a backend's `url` setting. */
  url: string
  /** The body of every img_gen call, in order. */
  received: Record<string, unknown>[]
  /** The job ids cancelled, in order. */
  cancelled: string[]
  close(): Promise<void>
}

export const MOCK_SDCPP_MODEL = 'mock-turbo-Q4_K'
/** In a prompt: the job stays at its first step until it is cancelled. */
export const SDCPP_HOLD = 'SDCPP_HOLD'

export async function startMockSdcpp(options: { port?: number } = {}): Promise<MockSdcpp> {
  sharp.cache(false)
  const png = (await sharp({ create: { width: 64, height: 96, channels: 3, background: '#5b8c6b' } }).png().toBuffer()).toString('base64')
  const received: Record<string, unknown>[] = []
  const cancelled: string[] = []
  const jobs = new Map<string, { polls: number; seed: number; cancelled: boolean; steps: number; held: boolean }>()
  let count = 0

  const capabilities = {
    model: { name: `${MOCK_SDCPP_MODEL}.gguf`, stem: MOCK_SDCPP_MODEL, path: `models/${MOCK_SDCPP_MODEL}.gguf` },
    current_mode: 'img_gen',
    supported_modes: ['img_gen'],
    features_by_mode: { img_gen: { init_image: true, mask_image: true, lora: true, hires: true, preview: true, cancel_queued: true, cancel_generating: true } },
    samplers: ['euler', 'euler_a', 'dpm++2m'],
    schedulers: ['discrete', 'karras'],
    loras: [{ name: 'ink', path: 'ink.safetensors', display_path: 'ink.safetensors' }],
    upscalers: [
      { name: 'None', model: false, image_upscale: false },
      { name: 'Lanczos', model: false, image_upscale: false },
      { name: 'Latent', model: false, image_upscale: false },
    ],
    preview_modes: ['none', 'proj'],
    limits: { min_width: 64, max_width: 4096, min_height: 64, max_height: 4096, max_batch_count: 8, max_queue_size: 16 },
    runtime: { state: 'ready', error: null },
  }

  const server: Server = createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const path = (req.url ?? '').split('?')[0]
      if (req.method === 'GET' && path === '/sdcpp/v1/capabilities') return send(200, capabilities)
      if (req.method === 'GET' && path === '/mock/cancelled') return send(200, { cancelled, received: received.length })
      if (req.method === 'POST' && path === '/sdcpp/v1/img_gen') {
        let body: Record<string, unknown>
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch {
          return send(400, { error: 'invalid JSON' })
        }
        received.push(body)
        count += 1
        const id = `job_${count}`
        const sample = (body.sample_params ?? {}) as { sample_steps?: number }
        jobs.set(id, { polls: 0, seed: typeof body.seed === 'number' && body.seed >= 0 ? body.seed : 4242, cancelled: false, steps: sample.sample_steps ?? 20, held: String(body.prompt ?? '').includes(SDCPP_HOLD) })
        return send(202, { id, kind: 'img_gen', status: 'queued', created: Date.now(), poll_url: `/sdcpp/v1/jobs/${id}` })
      }
      const jobMatch = /^\/sdcpp\/v1\/jobs\/([^/]+)(\/cancel)?$/.exec(path)
      if (jobMatch) {
        const job = jobs.get(jobMatch[1])
        if (!job) return send(404, { error: 'not found' })
        if (jobMatch[2] && req.method === 'POST') {
          job.cancelled = true
          cancelled.push(jobMatch[1])
          return send(200, { id: jobMatch[1], cancel_requested: true })
        }
        if (job.cancelled) return send(200, { id: jobMatch[1], status: 'cancelled', result: null, error: { code: 'cancelled', message: 'job cancelled by client' } })
        job.polls += 1
        if (job.polls === 1) return send(200, { id: jobMatch[1], status: 'queued', queue_position: 0, preview: null })
        if (job.polls === 2 || job.held) return send(200, { id: jobMatch[1], status: 'generating', preview: { pass: 1, step: 1, total_steps: job.steps, b64_json: png } })
        if (job.polls === 3) return send(200, { id: jobMatch[1], status: 'generating', preview: { pass: 1, step: job.steps, total_steps: job.steps, b64_json: png } })
        return send(200, {
          id: jobMatch[1],
          status: 'completed',
          result: { output_format: 'png', images: [{ index: 0, b64_json: png, generation_info: { seed: String(job.seed) } }] },
          error: null,
        })
      }
      send(404, { error: 'not found' })
    })
  })

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/`,
    received,
    cancelled,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
