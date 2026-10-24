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
  // answer's `people`, -1 for everyone, or a list of indices for some of them
  // (sorted, without repeats). Absent means the most confident.
  if (Number.isInteger(body.person) && (body.person as number) >= -1) request.person = body.person as number
  else if (Array.isArray(body.person)) {
    const indices = body.person as unknown[]
    if (!indices.length || indices.length > MAX_CHOSEN || !indices.every((index) => Number.isInteger(index) && (index as number) >= 0)) {
      return `person as a list must hold 1-${MAX_CHOSEN} indices`
    }
    request.person = [...new Set(indices as number[])].sort((a, b) => a - b)
  }
  if (body.want_3d === true) request.want_3d = true
  // Joints moved in the 3D view, in order: each bends the pose the ones
  // before it left, so they are kept as sent, repeats and all. Which joints
  // move is the backend's to say (`movable`); here only the shape is held.
  if (body.edits !== undefined && body.edits !== null) {
    const edits = body.edits as unknown[]
    const valid =
      Array.isArray(edits) &&
      edits.length <= MAX_EDITS &&
      edits.every((edit) => {
        const { person, joint, to } = (edit ?? {}) as Record<string, unknown>
        return (
          Number.isInteger(person) &&
          (person as number) >= 0 &&
          Number.isInteger(joint) &&
          (joint as number) >= 0 &&
          (joint as number) < 133 &&
          Array.isArray(to) &&
          to.length === 3 &&
          to.every((value) => finite(value) && Math.abs(value) <= MAX_REACH)
        )
      })
    if (!valid) return `edits must be a list of at most ${MAX_EDITS} { person, joint, to: [x, y, z] }`
    request.edits = (edits as PoseEdit[]).map(({ person, joint, to }) => ({ person, joint, to: [to[0], to[1], to[2]] }))
  }
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

// ── The pose slot's side: reading what /api/pose answers ─────────────────────

/** One joint moved: where it should point, in units of the picture's width like `points_3d`. */
export interface PoseEdit {
  person: number
  joint: number
  to: [number, number, number]
}

/** Whether two lists of edits are the same moves, in the same order. */
export const sameEdits = (a: readonly PoseEdit[], b: readonly PoseEdit[]) =>
  a.length === b.length &&
  a.every((edit, i) => edit.person === b[i].person && edit.joint === b[i].joint && edit.to.every((value, axis) => value === b[i].to[axis]))

/** The most edits one request may carry, and how far one may point (poseorbit holds to the same). */
export const MAX_EDITS = 256
const MAX_REACH = 16

/** The pose API's index for "every detected person" (see docs/backend-api.md). */
export const ALL_PEOPLE = -1

/** The skeleton the run will follow, as the backend's /pose drew it. */
export interface PoseSkeleton {
  dataUrl: string
  width: number
  height: number
}

/** One person the server found, as fractions of the reference picture: [x0, y0, x1, y1]. */
export interface DetectedPerson {
  bbox: [number, number, number, number]
  /** With want_3d: 133 points (x right, y down, z away) in units of the picture's width. */
  points_3d?: number[][]
  scores?: number[]
}

/** The camera as the 3D view and the answers carry it: framing always present. */
export type ViewCamera = PoseCamera & { framing: PoseFraming }

export const FRONT: ViewCamera = { yaw: 0, pitch: 0, framing: WHOLE_FRAME }

export const sameView = (a: ViewCamera, b: ViewCamera) =>
  a.yaw === b.yaw && a.pitch === b.pitch && a.framing.zoom === b.framing.zoom && a.framing.x === b.framing.x && a.framing.y === b.framing.y

/** How far a backend lets the camera swing and zoom. */
export interface PoseTurnLimits {
  yaw: number
  pitch: number
  zoom: readonly [number, number]
}

/** Who to draw: an index into `people`, ALL_PEOPLE, or some of them by index. */
export type PersonChoice = number | number[]

/** The most people one request may choose by a list (poseorbit holds to the same). */
export const MAX_CHOSEN = 64

/** The indices `person` means among `count` people (none for null). */
export function chosenIndices(person: PersonChoice | null, count: number): Set<number> {
  if (person === null) return new Set()
  if (person === ALL_PEOPLE) return new Set(Array.from({ length: count }, (_, index) => index))
  return new Set(Array.isArray(person) ? person : [person])
}

/**
 * The choice after `index` is switched on or off, or null when that would
 * leave nobody. One person stays a plain index and all of them become
 * ALL_PEOPLE, so a backend sees the same request as from the one-or-all chooser.
 */
export function toggledChoice(person: PersonChoice | null, index: number, count: number): PersonChoice | null {
  const chosen = chosenIndices(person, count)
  if (chosen.has(index)) chosen.delete(index)
  else chosen.add(index)
  if (chosen.size === 0) return null
  if (chosen.size === count) return ALL_PEOPLE
  const indices = [...chosen].sort((a, b) => a - b)
  return indices.length === 1 ? indices[0] : indices
}

/** One /api/pose answer, as the pose slot keeps it. */
export interface PoseAnswer {
  skeleton: PoseSkeleton
  people: DetectedPerson[]
  /** Who was drawn, or null when the backend does not say. */
  person: PersonChoice | null
  /** Whether the backend takes a list of people (`person_subsets`); without it, one or everyone. */
  subsets: boolean
  /** Null when the backend cannot turn a pose. */
  limits: PoseTurnLimits | null
  /** The joints the backend may move (`movable`); empty when it moves none. */
  movable: number[]
  /** How the skeleton was drawn ("openpose", "dwpose"), when it says. */
  style: string | null
  /** Body joints left inside the frame, when it says. */
  jointsInFrame: number | null
  /** The angle the skeleton was drawn from. */
  camera: ViewCamera
}

/** A /api/pose answer read leniently, as backends written before some fields still send it; null without a skeleton. */
export function readPoseAnswer(data: unknown): PoseAnswer | null {
  const answer = data as {
    skeleton_base64?: string
    width?: number
    height?: number
    people?: unknown
    person?: unknown
    person_subsets?: unknown
    movable?: unknown
    limits?: { yaw?: unknown; pitch: number; zoom?: unknown } | null
    style?: unknown
    joints_in_frame?: unknown
    camera?: { yaw?: unknown; pitch: number; framing?: PoseFraming } | null
  } | null
  if (!answer || typeof answer !== 'object' || !answer.skeleton_base64) return null
  const { limits, camera } = answer
  return {
    skeleton: { dataUrl: `data:image/png;base64,${answer.skeleton_base64}`, width: answer.width as number, height: answer.height as number },
    people: Array.isArray(answer.people) ? (answer.people as DetectedPerson[]) : [],
    person:
      typeof answer.person === 'number'
        ? answer.person
        : Array.isArray(answer.person) && answer.person.length && answer.person.every((index) => Number.isInteger(index))
          ? (answer.person as number[])
          : null,
    subsets: answer.person_subsets === true,
    movable: Array.isArray(answer.movable) ? answer.movable.filter((joint): joint is number => Number.isInteger(joint)) : [],
    limits:
      limits && typeof limits.yaw === 'number'
        ? {
            yaw: limits.yaw,
            pitch: limits.pitch,
            // A backend without framing gets a view that cannot zoom.
            zoom: Array.isArray(limits.zoom) ? (limits.zoom as [number, number]) : [1, 1],
          }
        : null,
    style: typeof answer.style === 'string' ? answer.style : null,
    jointsInFrame: typeof answer.joints_in_frame === 'number' ? answer.joints_in_frame : null,
    camera:
      camera && typeof camera.yaw === 'number' ? { yaw: camera.yaw, pitch: camera.pitch, framing: camera.framing ?? WHOLE_FRAME } : FRONT,
  }
}
