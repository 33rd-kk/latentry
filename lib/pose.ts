// The pose request Latentry passes on to a backend's /api/pose (see
// docs/backend-api.md), checked and clamped here so a backend never sees a
// camera past what a single picture's depth can support.

import type { PoseRequest } from '@/lib/backends/types'

/** How far the 3D camera may swing (degrees) and zoom. poseorbit holds to the same. */
export const POSE_LIMITS = { yaw: 90, pitch: 45, zoom: [0.5, 6] } as const

/** Framing on the output canvas: the point (x, y) (fractions) goes to the middle, scaled by zoom. */
export interface PoseFraming {
  zoom: number
  x: number
  y: number
}

export interface PoseCamera {
  yaw: number
  pitch: number
  framing?: PoseFraming
}

export const WHOLE_FRAME: PoseFraming = { zoom: 1, x: 0.5, y: 0.5 }

const between = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

export function clampFraming(framing: PoseFraming): PoseFraming {
  return {
    zoom: between(framing.zoom, POSE_LIMITS.zoom[0], POSE_LIMITS.zoom[1]),
    x: between(framing.x, 0, 1),
    y: between(framing.y, 0, 1),
  }
}

export function clampCamera(camera: PoseCamera): PoseCamera {
  return {
    yaw: between(camera.yaw, -POSE_LIMITS.yaw, POSE_LIMITS.yaw),
    pitch: between(camera.pitch, -POSE_LIMITS.pitch, POSE_LIMITS.pitch),
    ...(camera.framing ? { framing: clampFraming(camera.framing) } : {}),
  }
}

/** Whether a camera is the plain front view of the whole picture. */
export function isPlainView(camera: PoseCamera): boolean {
  const framing = camera.framing ?? WHOLE_FRAME
  return camera.yaw === 0 && camera.pitch === 0 && framing.zoom === 1 && framing.x === 0.5 && framing.y === 0.5
}

/** The request to send on, or the reason it is refused. */
export function toPoseRequest(body: Record<string, unknown> | null): PoseRequest | string {
  if (typeof body?.image_base64 !== 'string' || !body.image_base64) return 'image_base64 is required'
  const request: PoseRequest = { image_base64: body.image_base64 }
  if (finite(body.width)) request.width = body.width
  if (finite(body.height)) request.height = body.height
  // Whose pose in a picture of several people: an index into the previous
  // answer's `people`, or -1 for everyone. Absent means the most confident.
  if (Number.isInteger(body.person) && (body.person as number) >= -1) request.person = body.person as number
  if (body.want_3d === true) request.want_3d = true
  if (body.camera !== undefined && body.camera !== null) {
    const camera = body.camera as Record<string, unknown>
    if (typeof camera !== 'object' || !finite(camera.yaw ?? 0) || !finite(camera.pitch ?? 0)) {
      return 'camera must be { yaw, pitch } in degrees'
    }
    let framing: PoseFraming | undefined
    if (camera.framing !== undefined && camera.framing !== null) {
      const given = camera.framing as Record<string, unknown>
      if (typeof given !== 'object' || !finite(given.zoom ?? 1) || !finite(given.x ?? 0.5) || !finite(given.y ?? 0.5)) {
        return 'camera.framing must be { zoom, x, y }'
      }
      framing = {
        zoom: (given.zoom as number | undefined) ?? 1,
        x: (given.x as number | undefined) ?? 0.5,
        y: (given.y as number | undefined) ?? 0.5,
      }
    }
    request.camera = clampCamera({
      yaw: (camera.yaw as number | undefined) ?? 0,
      pitch: (camera.pitch as number | undefined) ?? 0,
      ...(framing ? { framing } : {}),
    })
  }
  return request
}
