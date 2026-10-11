// A stand-in for a diffusers-compatible server (docs/backend-api.md) that
// offers pose control, for browser tests of the pose slot without a GPU or a
// detector: /api/health says pose_control, and /api/pose answers three people
// left to right with a small skeleton PNG, turning limits and, when asked, flat
// 3D points. With `subsets` (the default) it takes a list of people and says
// so with person_subsets, as poseorbit 0.2 does; without, one or everyone.
// Every /api/pose body is recorded, so a test can check what the page asked for.

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import sharp from 'sharp'

export interface MockDiffusers {
  /** Base URL, with a trailing slash, as a backend's `url` setting. */
  url: string
  /** Every POST /api/pose body, in order, without its picture. */
  poses: Record<string, unknown>[]
  close(): Promise<void>
}

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
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
