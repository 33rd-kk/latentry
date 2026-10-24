// Moving a joint, as poseorbit does it (body.py): the 133 COCO-WholeBody
// points as a tree, and a joint turned about its parent with everything
// hanging from it, so no bone changes length. The 3D view bends its own copy
// while a joint is dragged; the server bends the same edits when it draws.
// Kept apart from the viewer so it can be checked without a browser.

/** `PARENT` of the nose: the middle of the shoulders, found when bending. */
export const NECK = -1

// Each point's parent: hips are roots, shoulders hang from the hips, the
// head from the neck, hands from the wrists and the face from the nose.
export const PARENT: readonly (number | null)[] = [
  NECK, 0, 0, 1, 2, 11, 12, 5, 6, 7, 8, null, null, 11, 12, 13, 14,
  15, 15, 15, 16, 16, 16,
  ...Array<number>(68).fill(0),
  ...Array<number>(21).fill(9),
  ...Array<number>(21).fill(10),
]

/** The joints an edit may move: the head, arms, legs and feet. */
export const MOVABLE: ReadonlySet<number> = new Set([0, 5, 6, 7, 8, 9, 10, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22])

/** One joint moved on one person; `to` is where it should point, in the points' units. */
export interface PoseEdit {
  person: number
  joint: number
  to: [number, number, number]
}

type Vec = [number, number, number]

const children = new Map<number, number[]>()
PARENT.forEach((parent, point) => {
  if (parent !== null && parent !== NECK) children.set(parent, [...(children.get(parent) ?? []), point])
})

/** `joint` and every point hanging from it, in index order. */
export function subtree(joint: number): number[] {
  const found = [joint]
  for (let i = 0; i < found.length; i++) found.push(...(children.get(found[i]) ?? []))
  return found.sort((a, b) => a - b)
}

/** The point `joint` turns about: its parent, or the neck for the nose. */
export function pivot(points: readonly number[][], joint: number): Vec {
  const parent = PARENT[joint]
  if (parent === null) throw new Error(`Joint ${joint} is a root and does not turn.`)
  if (parent === NECK) return [0, 1, 2].map((axis) => (points[5][axis] + points[6][axis]) / 2) as Vec
  return [points[parent][0], points[parent][1], points[parent][2]]
}

const sub = (a: readonly number[], b: readonly number[]): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: Vec) => Math.hypot(a[0], a[1], a[2])
const scaled = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k]

/** The smallest rotation taking direction `u` onto `v` (both unit length), as rows. */
function rotation(u: Vec, v: Vec): Vec[] {
  let axis = cross(u, v)
  const sine = norm(axis)
  const cosine = dot(u, v)
  if (sine < 1e-12) {
    if (cosine > 0) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
    // Straight back: half a turn about any axis square to u.
    axis = cross(u, [1, 0, 0])
    if (norm(axis) < 1e-6) axis = cross(u, [0, 1, 0])
    const a = scaled(axis, 1 / norm(axis))
    return [0, 1, 2].map((r) => [0, 1, 2].map((c) => 2 * a[r] * a[c] - (r === c ? 1 : 0))) as Vec[]
  }
  const [x, y, z] = scaled(axis, 1 / sine)
  const k: Vec[] = [[0, -z, y], [z, 0, -x], [-y, x, 0]]
  const kk = [0, 1, 2].map((r) => [0, 1, 2].map((c) => k[r][0] * k[0][c] + k[r][1] * k[1][c] + k[r][2] * k[2][c]))
  return [0, 1, 2].map((r) => [0, 1, 2].map((c) => (r === c ? 1 : 0) + sine * k[r][c] + (1 - cosine) * kk[r][c])) as Vec[]
}

/**
 * `points` with `joint` turned about its parent to point at `target`, its
 * subtree carried along. The joint keeps its distance from the parent, so it
 * ends on the line from the parent through `target`. `points` is left alone.
 */
export function bend(points: readonly number[][], joint: number, target: readonly number[]): number[][] {
  if (!MOVABLE.has(joint)) throw new Error(`Joint ${joint} cannot be moved.`)
  const bent = points.map((point) => [...point])
  const centre = pivot(bent, joint)
  const u = sub(bent[joint], centre)
  const v = sub(target, centre)
  const length = norm(u)
  const reach = norm(v)
  if (length < 1e-9 || reach < 1e-9) return bent
  const turn = rotation(scaled(u, 1 / length), scaled(v, 1 / reach))
  for (const index of subtree(joint)) {
    const offset = sub(bent[index], centre)
    bent[index] = turn.map((row, axis) => dot(row, offset) + centre[axis])
  }
  return bent
}

/** Everyone's points with `edits` bent in, one after another; order matters. */
export function applyEdits(people: readonly (readonly number[][])[], edits: readonly PoseEdit[]): number[][][] {
  const bent = people.map((points) => points.map((point) => [...point]))
  for (const edit of edits) {
    if (edit.person < 0 || edit.person >= bent.length) throw new Error(`No person ${edit.person}: ${bent.length} found.`)
    bent[edit.person] = bend(bent[edit.person], edit.joint, edit.to)
  }
  return bent
}
