// A stand-in for the AUTOMATIC1111 / Forge web UI API, for tests that run a
// whole generation without a GPU: the few /sdapi/v1 calls lib/backends/a1111.ts
// makes, answered with a small real PNG. It knows nothing about Latentry, so
// the route tests and the browser tests (e2e/) share it.

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import sharp from 'sharp'

export interface MockA1111 {
  /** Base URL, with a trailing slash, as a backend's `url` setting. */
  url: string
  /** The body of every txt2img and img2img call, in order. */
  received: Record<string, unknown>[]
  /** Holds generate answers back until release(), to see a run while it is running. */
  hold(): void
  release(): void
  close(): Promise<void>
}

/** Seed reported for a request that asks for a random one (-1). */
export const MOCK_SEED = 123

/** The tags the mock tagger finds in any picture, as the gallery stores them. */
export const MOCK_TAGS = [
  { name: 'lighthouse', score: 0.9, category: 0 },
  { name: 'mock_character', score: 0.88, category: 4 },
  { name: 'dusk', score: 0.6, category: 0 },
]

/**
 * Listens on 127.0.0.1 only; port 0 (the default) picks a free one. With
 * `tagger`, it also answers as the WD14 tagger extension, finding MOCK_TAGS.
 */
export async function startMockA1111(options: { port?: number; tagger?: boolean } = {}): Promise<MockA1111> {
  // Without this sharp keeps what it read open on Windows, and a test cannot delete its folder.
  sharp.cache(false)
  const png = (await sharp({ create: { width: 64, height: 96, channels: 3, background: '#6b7c93' } }).png().toBuffer()).toString('base64')

  const received: Record<string, unknown>[] = []
  let held = false
  let waiting: (() => void)[] = []

  const server: Server = createServer((request, response) => {
    let text = ''
    request.on('data', (chunk) => (text += chunk))
    request.on('end', () => {
      const reply = (status: number, body: unknown) => {
        response.writeHead(status, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify(body))
      }
      const route = `${request.method} ${(request.url ?? '').split('?')[0]}`
      switch (route) {
        case 'GET /sdapi/v1/progress':
          // Never busy: the adapter refuses to start while another client is.
          return reply(200, { state: { job_count: 0, job_no: 0, job_timestamp: '0', sampling_step: 0, sampling_steps: 0 } })
        case 'GET /sdapi/v1/options':
          return reply(200, { sd_model_checkpoint: 'mock-model.safetensors' })
        case 'GET /sdapi/v1/samplers':
          return reply(200, [{ name: 'Euler' }])
        case 'GET /sdapi/v1/upscalers':
          return reply(200, [{ name: 'None' }, { name: 'Lanczos' }, { name: 'R-ESRGAN 4x+' }])
        case 'GET /sdapi/v1/latent-upscale-modes':
          return reply(200, [{ name: 'Latent' }])
        case 'GET /sdapi/v1/schedulers':
          return reply(200, [{ label: 'Karras' }])
        case 'POST /sdapi/v1/interrupt':
          return reply(200, {})
        case 'GET /tagger/v1/interrogators':
          if (!options.tagger) break
          return reply(200, { models: ['mock-tagger', 'wd-mock-tagger'] })
        case 'POST /tagger/v1/interrogate':
          if (!options.tagger) break
          return reply(200, {
            caption: {
              rating: { general: 0.95 },
              general: Object.fromEntries(MOCK_TAGS.filter((tag) => tag.category === 0).map((tag) => [tag.name, tag.score])),
              character: Object.fromEntries(MOCK_TAGS.filter((tag) => tag.category === 4).map((tag) => [tag.name, tag.score])),
            },
          })
        // An upscale's first call: its "enlarged" picture is the same small PNG.
        case 'POST /sdapi/v1/extra-single-image':
          return reply(200, { image: png, html_info: '' })
        case 'POST /sdapi/v1/txt2img':
        case 'POST /sdapi/v1/img2img': {
          let body: Record<string, unknown> = {}
          try {
            body = JSON.parse(text)
          } catch {
            return reply(422, { error: 'Invalid JSON' })
          }
          received.push(body)
          const count = typeof body.n_iter === 'number' && body.n_iter > 0 ? body.n_iter : 1
          const seed = typeof body.seed === 'number' && body.seed >= 0 ? body.seed : MOCK_SEED
          const answer = () =>
            reply(200, {
              images: Array.from({ length: count }, () => png),
              info: JSON.stringify({ all_seeds: Array.from({ length: count }, (_, index) => seed + index) }),
            })
          return held ? void waiting.push(answer) : answer()
        }
      }
      // The tagger extension among them, unless asked for: a 404 says it is not installed.
      reply(404, { detail: 'Not Found' })
    })
  })
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  const release = () => {
    held = false
    const answers = waiting
    waiting = []
    answers.forEach((answer) => answer())
  }

  return {
    url: `http://127.0.0.1:${port}/`,
    received,
    hold: () => {
      held = true
    },
    release,
    close: () => {
      release()
      server.closeAllConnections()
      return new Promise((resolve) => server.close(() => resolve()))
    },
  }
}
