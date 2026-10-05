// The pose request Latentry passes on to a backend's /api/pose (see
// docs/backend-api.md), checked and clamped here so a backend never sees a
// camera past what a single picture's depth can support.

import type { PoseRequest } from '@/lib/backends/types'

/** How far the 3D camera may swing, in degrees. poseorbit holds to the same. */
export const POSE_LIMITS = { yaw: 90, pitch: 45 } as const

export interface PoseCamera {
  yaw: number
  pitch: number
}

const clamp = (value: number, limit: number) => Math.min(limit, Math.max(-limit, value))
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

export function clampCamera(camera: PoseCamera): PoseCamera {
  return { yaw: clamp(camera.yaw, POSE_LIMITS.yaw), pitch: clamp(camera.pitch, POSE_LIMITS.pitch) }
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
    request.camera = clampCamera({ yaw: (camera.yaw as number | undefined) ?? 0, pitch: (camera.pitch as number | undefined) ?? 0 })
  }
  return request
}
