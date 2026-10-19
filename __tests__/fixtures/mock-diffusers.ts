// A stand-in for a diffusers-compatible server (docs/backend-api.md) that
// offers pose control, for browser tests of the pose slot without a GPU or a
// detector: /api/health says pose_control, and /api/pose answers three people
// left to right with a small skeleton PNG, turning limits and, when asked, flat
// 3D points. With `subsets` (the default) it takes a list of people and says
// so with person_subsets, as poseorbit 0.2 does; without, one or everyone.
// Every /api/pose body is recorded, so a test can check what the page asked for.
// /api/generate streams `image_count` small PNGs, image i seeded `seed + i`
// (a random seed starts at 1000), with two steps each. A prompt with
// UNTIL_CANCELLED in it never finishes: it steps on until /api/cancel names
// its run, for tests of a run that is still going.

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import sharp from 'sharp'

export interface MockDiffusers {
  /** Base URL, with a trailing slash, as a backend's `url` setting. */
  url: string
  /** Every POST /api/pose body, in order, without its picture. */
  poses: Record<string, unknown>[]
  /** Every POST /api/generate body, in order, without its pictures. */
  generates: Record<string, unknown>[]
  close(): Promise<void>
}

/** In a prompt, keeps the run going until it is cancelled. */
export const UNTIL_CANCELLED = 'mock: until cancelled'

/** The steps each mock picture reports. */
export const MOCK_GENERATE_STEPS = 2

/** The people it finds, as fractions of the picture: [x0, y0, x1, y1]. */
export const MOCK_PEOPLE: [number, number, number, number][] = [
  [0.05, 0.2, 0.3, 0.95],
  [0.38, 0.15, 0.62, 0.95],
  [0.7, 0.25, 0.95, 0.95],
]
/** The one it draws when the request names nobody: "the most confident". */
export const MOCK_MOST_CONFIDENT = 1

/** A standing figure's 133 points around x (units of the picture's width); only the 17 body joints are seen. */
function figure(x: number): { points_3d: number[][]; scores: number[] } {
  const body = [
    [0, 0.3], [0.02, 0.28], [-0.02, 0.28], [0.04, 0.29], [-0.04, 0.29],
    [0.08, 0.4], [-0.08, 0.4], [0.1, 0.55], [-0.1, 0.55], [0.11, 0.68], [-0.11, 0.68],
    [0.06, 0.7], [-0.06, 0.7], [0.06, 0.95], [-0.06, 0.95], [0.06, 1.2], [-0.06, 1.2],
  ]
  const points_3d = Array.from({ length: 133 }, (_, index) => {
    const [dx, y] = body[index] ?? [0, 0.3]
    return [x + dx, y, 0]
  })
  return { points_3d, scores: points_3d.map((_, index) => (index < 17 ? 0.9 : 0)) }
}

/** Listens on 127.0.0.1 only; port 0 (the default) picks a free one. */
export async function startMockDiffusers(options: { port?: number; subsets?: boolean } = {}): Promise<MockDiffusers> {
  const subsets = options.subsets ?? true
  // Without this sharp keeps what it read open on Windows, and a test cannot delete its folder.
  sharp.cache(false)
  const skeleton = (await sharp({ create: { width: 64, height: 96, channels: 3, background: '#000000' } }).png().toBuffer()).toString('base64')
  const poses: Record<string, unknown>[] = []
  const generates: Record<string, unknown>[] = []
  const cancelled = new Set<string>()
  const picture = (index: number) =>
    sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 40 * index, g: 120, b: 200 } } }).png().toBuffer()

  const server: Server = createServer((request, response) => {
    let text = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => (text += chunk))
    request.on('end', () => {
      const reply = (status: number, body: unknown) => {
        response.writeHead(status, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify(body))
      }
      const route = `${request.method} ${new URL(request.url ?? '/', 'http://mock').pathname}`
      if (route === 'GET /api/health') {
        return reply(200, { status: 'ok', model: 'mock-pose-model', pose_control: true, lora: false, tagger: false, busy: false })
      }
      if (route === 'GET /api/presets') return reply(200, { default: null, presets: [] })
      if (route === 'POST /api/cancel') {
        let runId: unknown
        try {
          runId = JSON.parse(text)?.run_id
        } catch {
          runId = null
        }
        if (typeof runId === 'string') cancelled.add(runId)
        return reply(200, { status: 'cancelling' })
      }
      if (route === 'POST /api/generate') {
        let body: Record<string, unknown>
        try {
          body = JSON.parse(text)
        } catch {
          return reply(400, { error: 'Invalid JSON body' })
        }
        const { init_image_base64: _source, mask_base64: _mask, pose_image_base64: _pose, ...asked } = body
        generates.push(asked)
        const total = typeof body.image_count === 'number' ? body.image_count : 1
        const first = typeof body.seed === 'number' && body.seed >= 0 ? body.seed : 1000
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' })
        const send = (event: string, data: unknown) => response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        const runId = `mock-run-${generates.length}`
        if (typeof body.prompt === 'string' && body.prompt.includes(UNTIL_CANCELLED)) {
          send('start', { index: 0, total, steps: 1000, run_id: runId })
          let step = 0
          const timer = setInterval(() => {
            if (cancelled.has(runId) || response.destroyed) {
              clearInterval(timer)
              send('cancelled', {})
              response.end()
              return
            }
            send('step', { index: 0, step: (step = Math.min(999, step + 1)) })
          }, 100)
          return
        }
        void (async () => {
          for (let index = 0; index < total; index++) {
            send('start', { index, total, steps: MOCK_GENERATE_STEPS, run_id: runId })
            for (let step = 1; step <= MOCK_GENERATE_STEPS; step++) send('step', { index, step })
            const image_base64 = (await picture(index)).toString('base64')
            send('image', { index, total, seed: first + index, image_base64, steps_observed: MOCK_GENERATE_STEPS })
          }
          send('done', {})
          response.end()
        })()
        return
      }
      if (route === 'POST /api/pose') {
        let body: Record<string, unknown>
        try {
          body = JSON.parse(text)
        } catch {
          return reply(400, { error: 'Invalid JSON body' })
        }
        const { image_base64: _picture, ...asked } = body
        poses.push(asked)
        const person = typeof body.person === 'number' || (subsets && Array.isArray(body.person)) ? body.person : MOCK_MOST_CONFIDENT
        const want3d = body.want_3d === true
        const camera = (body.camera as Record<string, unknown> | undefined) ?? { yaw: 0, pitch: 0 }
        return reply(200, {
          skeleton_base64: skeleton,
          width: typeof body.width === 'number' ? body.width : 832,
          height: typeof body.height === 'number' ? body.height : 1216,
          person,
          ...(subsets ? { person_subsets: true } : {}),
          style: 'dwpose',
          joints_in_frame: 17,
          camera: { yaw: camera.yaw ?? 0, pitch: camera.pitch ?? 0, framing: camera.framing ?? { zoom: 1, x: 0.5, y: 0.5 } },
          limits: { yaw: 90, pitch: 45, zoom: [0.5, 6] },
          people: MOCK_PEOPLE.map((bbox) => ({ bbox, ...(want3d ? figure((bbox[0] + bbox[2]) / 2) : {}) })),
        })
      }
      reply(404, { error: `No ${route} here` })
    })
  })

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/`,
    poses,
    generates,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
