// A 3D view of detected poses: drag to swing the camera around the figure,
// wheel or pinch to zoom, right-drag (or shift-drag, or two fingers) to move
// the frame, and drag a joint to move it (bend.ts). Plain three.js on a canvas: no React, no app code, so it can be
// lifted out with poseorbit.
//
// Points come from poseorbit's /api/pose `want_3d`: x right, y down, z away
// from the viewer, all in units of the picture's width. The view reproduces
// what the server will draw for the same camera, edge to edge: the camera is
// orthographic and orbits the middle of the shown people's hips; the picture
// is letterboxed onto the output canvas; then the framing (zoom around a
// canvas point) crops it. The canvas element should have the output's aspect.

import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { applyEdits, type PoseEdit } from "./bend"
import { aimCamera, DEG, DISTANCE, frustumFor, toThree, type ViewerFrame, type ViewerFraming } from "./projection"
import { COCO133_LINKS, FACE_POINTS, KEYPOINT_THRESHOLD } from "./skeleton"

export type { PoseEdit, ViewerFrame, ViewerFraming }

export interface PosePerson3d {
  points_3d: number[][]
  scores: number[]
}

export interface ViewerCamera {
  /** Degrees; + swings the camera to the viewer's right. */
  yaw: number
  /** Degrees; + raises the camera. */
  pitch: number
  framing: ViewerFraming
}

/** Which people are shown: an index, -1 for everyone, or some of them by index. */
export type ShownPeople = number | readonly number[]

export interface PoseViewerOptions {
  people: PosePerson3d[]
  person: ShownPeople
  /** How far the camera may swing (degrees) and zoom. */
  limits: { yaw: number; pitch: number; zoom: readonly [number, number] }
  frame: ViewerFrame
  camera?: ViewerCamera
  /** Called while the camera or the framing moves. */
  onChange?: (camera: ViewerCamera) => void
  /** Joints moved so far, in order, on `people` as given. */
  edits?: readonly PoseEdit[]
  /** The joints a drag may move; none, and joints don't move. */
  movable?: ReadonlySet<number>
  /** Called once a joint has been dragged somewhere: the edit to add. */
  onEdit?: (edit: PoseEdit) => void
}

export interface PoseViewer {
  setPeople(people: PosePerson3d[], person: ShownPeople): void
  setEdits(edits: readonly PoseEdit[]): void
  setMovable(movable: ReadonlySet<number>): void
  setFrame(frame: ViewerFrame): void
  getCamera(): ViewerCamera
  setCamera(camera: ViewerCamera): void
  dispose(): void
}

export const WHOLE: ViewerFraming = { zoom: 1, x: 0.5, y: 0.5 }

const between = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

/** The orbit centre, in picture units (y down): the middle of the shown people's hips. */
function centreOf(people: PosePerson3d[]): { x: number; y: number } {
  const hips = people.flatMap((person) => [person.points_3d[11], person.points_3d[12]])
  if (!hips.length) return { x: 0.5, y: 0.5 }
  return {
    x: hips.reduce((sum, point) => sum + point[0], 0) / hips.length,
    y: hips.reduce((sum, point) => sum + point[1], 0) / hips.length,
  }
}

function buildFigure(people: PosePerson3d[]): THREE.Group {
  const group = new THREE.Group()
  const positions: number[] = []
  const colours: number[] = []
  const dots: number[] = []
  const colour = new THREE.Color()
  for (const person of people) {
    const seen = (index: number) => person.scores[index] >= KEYPOINT_THRESHOLD
    for (const [from, to, rgb] of COCO133_LINKS) {
      if (!seen(from) || !seen(to)) continue
      colour.setHex(rgb)
      for (const index of [from, to]) {
        positions.push(...toThree(person.points_3d[index]).toArray())
        colours.push(colour.r, colour.g, colour.b)
      }
    }
    person.points_3d.forEach((point, index) => {
      // Joints and the face's outline points; hands are dense enough as lines.
      if (seen(index) && (index < 91 || (index >= FACE_POINTS.first && index <= FACE_POINTS.last))) {
        dots.push(...toThree(point).toArray())
      }
    })
  }
  const lines = new THREE.BufferGeometry()
  lines.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  lines.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3))
  group.add(new THREE.LineSegments(lines, new THREE.LineBasicMaterial({ vertexColors: true })))
  const points = new THREE.BufferGeometry()
  points.setAttribute("position", new THREE.Float32BufferAttribute(dots, 3))
  group.add(new THREE.Points(points, new THREE.PointsMaterial({ color: 0xffffff, size: 3, sizeAttenuation: false })))
  return group
}

function disposeGroup(group: THREE.Group) {
  group.traverse((object) => {
    if (object instanceof THREE.LineSegments || object instanceof THREE.Points) {
      object.geometry.dispose()
      ;(object.material as THREE.Material).dispose()
    }
  })
}

export function createPoseViewer(canvas: HTMLCanvasElement, options: PoseViewerOptions): PoseViewer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x000000)
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100)
  const controls = new OrbitControls(camera, canvas)
  // Rotation only: zoom and panning are the framing, handled below so the
  // orbit centre stays where the server keeps it.
  controls.enablePan = false
  controls.enableZoom = false
  controls.enableDamping = false
  // Yaw is OrbitControls' azimuth; pitch is 90 degrees minus its polar angle.
  controls.minAzimuthAngle = -options.limits.yaw * DEG
  controls.maxAzimuthAngle = options.limits.yaw * DEG
  controls.minPolarAngle = (90 - options.limits.pitch) * DEG
  controls.maxPolarAngle = (90 + options.limits.pitch) * DEG

  // A floor under the feet, so a turn reads as a turn.
  const floor = new THREE.GridHelper(1.5, 10, 0x5a5a5a, 0x333333)
  scene.add(floor)

  let figure: THREE.Group | null = null
  let frame = options.frame
  let framing: ViewerFraming = options.camera?.framing ?? WHOLE
  let centre = { x: 0.5, y: 0.5 }
  let people = options.people
  let shownIndices: number[] = []
  let edits: readonly PoseEdit[] = options.edits ?? []
  let movable: ReadonlySet<number> = options.movable ?? new Set()
  // The shown people's points as drawn: detected, with the edits bent in.
  let shownPoints: number[][][] = []

  const render = () => renderer.render(scene, camera)

  /** The projection that shows exactly the framed part of the output canvas. */
  const project = () => {
    const { clientWidth, clientHeight } = canvas
    if (!clientWidth || !clientHeight) return
    renderer.setSize(clientWidth, clientHeight, false)
    Object.assign(camera, frustumFor(frame, framing, centre))
    camera.updateProjectionMatrix()
    render()
  }

  const read = (): ViewerCamera => {
    const offset = camera.position.clone().sub(controls.target)
    return {
      yaw: Math.round(Math.atan2(offset.x, offset.z) / DEG),
      pitch: Math.round(Math.atan2(offset.y, Math.hypot(offset.x, offset.z)) / DEG),
      framing: {
        zoom: Math.round(framing.zoom * 100) / 100,
        x: Math.round(framing.x * 1000) / 1000,
        y: Math.round(framing.y * 1000) / 1000,
      },
    }
  }
  const changed = () => options.onChange?.(read())

  const setFraming = (next: ViewerFraming) => {
    framing = {
      zoom: between(next.zoom, options.limits.zoom[0], options.limits.zoom[1]),
      x: between(next.x, 0, 1),
      y: between(next.y, 0, 1),
    }
    project()
  }

  const place = ({ yaw, pitch, framing: next }: ViewerCamera) => {
    aimCamera(
      camera,
      controls.target,
      between(yaw, -options.limits.yaw, options.limits.yaw),
      between(pitch, -options.limits.pitch, options.limits.pitch)
    )
    controls.update()
    setFraming(next)
  }

  /** Draws the shown people with `pending` (a joint being dragged) bent in after the edits. */
  const redraw = (pending?: PoseEdit) => {
    let bent: number[][][]
    try {
      bent = applyEdits(people.map((detected) => detected.points_3d), pending ? [...edits, pending] : edits)
    } catch {
      // Edits for people who are not here (a new picture on its way): show them as detected.
      bent = people.map((detected) => detected.points_3d)
    }
    shownPoints = shownIndices.map((index) => bent[index])
    if (figure) {
      scene.remove(figure)
      disposeGroup(figure)
    }
    figure = buildFigure(shownIndices.map((index, i) => ({ points_3d: shownPoints[i], scores: people[index].scores })))
    scene.add(figure)
    render()
  }

  const setPeople = (next: PosePerson3d[], person: ShownPeople) => {
    people = next
    const picked = typeof person === "number" ? (person >= 0 ? [person] : []) : person
    const inRange = picked.filter((index) => index >= 0 && index < people.length)
    // Everyone for -1, and for a choice that names nobody who is there.
    shownIndices = inRange.length ? inRange : people.map((_, index) => index)
    const shown = shownIndices.map((index) => people[index])
    redraw()
    const keep = read()
    // The hips never move, so the orbit centre and the floor come from the
    // figure as detected: a raised leg does not lift the floor.
    centre = centreOf(shown)
    controls.target.copy(toThree([centre.x, centre.y, 0]))
    const detected = buildFigure(shown)
    const box = new THREE.Box3().setFromObject(detected)
    disposeGroup(detected)
    floor.position.set(controls.target.x, box.min.y, controls.target.z)
    place(keep)
  }

  // ── Moving a joint ──────────────────────────────────────────────────────

  // How near (CSS pixels) a press must land on a joint to grab it.
  const GRAB_RADIUS = 10

  /** The movable, seen joint drawn nearest to (clientX, clientY), within reach. */
  const jointAt = (clientX: number, clientY: number) => {
    const rect = canvas.getBoundingClientRect()
    let best: { person: number; joint: number; at: THREE.Vector3 } | null = null
    let bestDistance = GRAB_RADIUS
    shownIndices.forEach((person, i) => {
      const { scores } = people[person]
      for (const joint of movable) {
        if (scores[joint] < KEYPOINT_THRESHOLD) continue
        const at = toThree(shownPoints[i][joint])
        const screen = at.clone().project(camera)
        const x = rect.left + ((screen.x + 1) / 2) * rect.width
        const y = rect.top + ((1 - screen.y) / 2) * rect.height
        const distance = Math.hypot(x - clientX, y - clientY)
        if (distance < bestDistance) {
          bestDistance = distance
          best = { person, joint, at }
        }
      }
    })
    return best as { person: number; joint: number; at: THREE.Vector3 } | null
  }

  // The joint being dragged, on a plane through it facing the camera.
  let grabbed: { person: number; joint: number; plane: THREE.Plane; pointerId: number; to: PoseEdit["to"] | null } | null = null
  const raycaster = new THREE.Raycaster()

  /** Where (clientX, clientY) lands on the grabbed joint's plane, in picture units (y down, z away). */
  const pointOnPlane = (plane: THREE.Plane, clientX: number, clientY: number): PoseEdit["to"] | null => {
    const rect = canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, 1 - ((clientY - rect.top) / rect.height) * 2)
    raycaster.setFromCamera(ndc, camera)
    const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3())
    return hit ? [hit.x, -hit.y, -hit.z] : null
  }

  // In the capture phase, so it runs before OrbitControls' own listener on
  // the canvas: a press on a joint never swings the camera.
  const onGrab = (event: PointerEvent) => {
    if (grabbed || !event.isPrimary || (event.pointerType === "mouse" && (event.button !== 0 || event.shiftKey))) return
    const hit = jointAt(event.clientX, event.clientY)
    if (!hit) return
    event.stopImmediatePropagation()
    event.preventDefault()
    const facing = camera.getWorldDirection(new THREE.Vector3())
    grabbed = {
      person: hit.person,
      joint: hit.joint,
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint(facing, hit.at),
      pointerId: event.pointerId,
      to: null,
    }
    canvas.setPointerCapture?.(event.pointerId)
    canvas.style.cursor = "grabbing"
  }
  const onDrag = (event: PointerEvent) => {
    if (!grabbed) {
      // Show that a joint can be grabbed here.
      if (event.pointerType === "mouse" && event.buttons === 0) canvas.style.cursor = jointAt(event.clientX, event.clientY) ? "grab" : ""
      return
    }
    if (event.pointerId !== grabbed.pointerId) return
    const to = pointOnPlane(grabbed.plane, event.clientX, event.clientY)
    if (!to) return
    grabbed.to = to
    redraw({ person: grabbed.person, joint: grabbed.joint, to })
  }
  const onDrop = (event: PointerEvent) => {
    if (!grabbed || event.pointerId !== grabbed.pointerId) return
    const { person, joint, to } = grabbed
    grabbed = null
    canvas.style.cursor = ""
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    // One drag is one edit, from the pose before it: never merged, since two
    // bends in a row twist a hand differently from one.
    if (to && event.type === "pointerup") {
      options.onEdit?.({ person, joint, to: to.map((value) => Math.round(value * 1e5) / 1e5) as PoseEdit["to"] })
    } else redraw()
  }
  canvas.addEventListener("pointerdown", onGrab, { capture: true })
  canvas.addEventListener("pointermove", onDrag)
  canvas.addEventListener("pointerup", onDrop)
  canvas.addEventListener("pointercancel", onDrop)

  // ── Framing by hand ─────────────────────────────────────────────────────

  /** Zoom by `factor`, keeping the canvas point under (clientX, clientY) where it is. */
  const zoomAt = (factor: number, clientX: number, clientY: number) => {
    const rect = canvas.getBoundingClientRect()
    const u = (clientX - rect.left) / rect.width - 0.5
    const v = (clientY - rect.top) / rect.height - 0.5
    const zoom = between(framing.zoom * factor, options.limits.zoom[0], options.limits.zoom[1])
    const pointX = framing.x + u / framing.zoom
    const pointY = framing.y + v / framing.zoom
    setFraming({ zoom, x: pointX - u / zoom, y: pointY - v / zoom })
    changed()
  }

  /** Move the frame with a drag of (dx, dy) screen pixels: the picture follows the pointer. */
  const panBy = (dx: number, dy: number) => {
    const rect = canvas.getBoundingClientRect()
    setFraming({ ...framing, x: framing.x - dx / rect.width / framing.zoom, y: framing.y - dy / rect.height / framing.zoom })
    changed()
  }

  const onWheel = (event: WheelEvent) => {
    event.preventDefault()
    zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY)
  }

  // Pointers down on the canvas: one mouse pan (right or shift), or two touches.
  const pointers = new Map<number, { x: number; y: number }>()
  let mousePan: { x: number; y: number } | null = null
  const pinchOf = () => {
    const [a, b] = [...pointers.values()]
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) }
  }
  let pinch: ReturnType<typeof pinchOf> | null = null

  const onPointerDown = (event: PointerEvent) => {
    if (grabbed) return
    if (event.pointerType === "mouse") {
      if (event.button === 2 || (event.button === 0 && event.shiftKey)) mousePan = { x: event.clientX, y: event.clientY }
      return
    }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    pinch = pointers.size === 2 ? pinchOf() : null
  }
  const onPointerMove = (event: PointerEvent) => {
    if (grabbed) return
    if (mousePan) {
      panBy(event.clientX - mousePan.x, event.clientY - mousePan.y)
      mousePan = { x: event.clientX, y: event.clientY }
      return
    }
    if (!pointers.has(event.pointerId)) return
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.size !== 2 || !pinch) return
    const now = pinchOf()
    panBy(now.x - pinch.x, now.y - pinch.y)
    if (pinch.distance > 0) zoomAt(now.distance / pinch.distance, now.x, now.y)
    pinch = now
  }
  const onPointerUp = (event: PointerEvent) => {
    mousePan = null
    pointers.delete(event.pointerId)
    pinch = pointers.size === 2 ? pinchOf() : null
  }
  const onContextMenu = (event: Event) => event.preventDefault()

  canvas.addEventListener("wheel", onWheel, { passive: false })
  canvas.addEventListener("pointerdown", onPointerDown)
  window.addEventListener("pointermove", onPointerMove)
  window.addEventListener("pointerup", onPointerUp)
  window.addEventListener("pointercancel", onPointerUp)
  canvas.addEventListener("contextmenu", onContextMenu)

  controls.addEventListener("change", () => {
    render()
    changed()
  })
  const observer = new ResizeObserver(project)
  observer.observe(canvas)

  camera.position.set(0, 0, DISTANCE)
  setPeople(options.people, options.person)
  place(options.camera ?? { yaw: 0, pitch: 0, framing: WHOLE })

  return {
    setPeople,
    setEdits(next) {
      edits = next
      if (!grabbed) redraw()
    },
    setMovable(next) {
      movable = next
    },
    setFrame(next) {
      frame = next
      project()
    },
    getCamera: read,
    setCamera: place,
    dispose() {
      observer.disconnect()
      canvas.removeEventListener("wheel", onWheel)
      canvas.removeEventListener("pointerdown", onPointerDown)
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("pointerup", onPointerUp)
      window.removeEventListener("pointercancel", onPointerUp)
      canvas.removeEventListener("contextmenu", onContextMenu)
      canvas.removeEventListener("pointerdown", onGrab, { capture: true })
      canvas.removeEventListener("pointermove", onDrag)
      canvas.removeEventListener("pointerup", onDrop)
      canvas.removeEventListener("pointercancel", onDrop)
      controls.dispose()
      if (figure) disposeGroup(figure)
      floor.geometry.dispose()
      ;(floor.material as THREE.Material).dispose()
      renderer.dispose()
    },
  }
}
