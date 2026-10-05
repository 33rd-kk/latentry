// A 3D view of detected poses: drag to swing the camera around the figure,
// wheel or pinch to zoom, right-drag (or shift-drag, or two fingers) to move
// the frame. Plain three.js on a canvas: no React, no app code, so it can be
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
import { aimCamera, DEG, DISTANCE, frustumFor, toThree, type ViewerFrame, type ViewerFraming } from "./projection"
import { COCO133_LINKS, FACE_POINTS, KEYPOINT_THRESHOLD } from "./skeleton"

export type { ViewerFrame, ViewerFraming }

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

export interface PoseViewerOptions {
  people: PosePerson3d[]
  /** Which person is shown, or -1 for everyone. */
  person: number
  /** How far the camera may swing (degrees) and zoom. */
  limits: { yaw: number; pitch: number; zoom: readonly [number, number] }
  frame: ViewerFrame
  camera?: ViewerCamera
  /** Called while the camera or the framing moves. */
  onChange?: (camera: ViewerCamera) => void
}

export interface PoseViewer {
  setPeople(people: PosePerson3d[], person: number): void
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
  const floor = new THREE.GridHelper(1.5, 10, 0x444444, 0x222222)
  scene.add(floor)

  let figure: THREE.Group | null = null
  let frame = options.frame
  let framing: ViewerFraming = options.camera?.framing ?? WHOLE
  let centre = { x: 0.5, y: 0.5 }

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

  const setPeople = (people: PosePerson3d[], person: number) => {
    const shown = person >= 0 && person < people.length ? [people[person]] : people
    if (figure) {
      scene.remove(figure)
      disposeGroup(figure)
    }
    figure = buildFigure(shown)
    scene.add(figure)
    const keep = read()
    centre = centreOf(shown)
    controls.target.copy(toThree([centre.x, centre.y, 0]))
    const box = new THREE.Box3().setFromObject(figure)
    floor.position.set(controls.target.x, box.min.y, controls.target.z)
    place(keep)
  }

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
    if (event.pointerType === "mouse") {
      if (event.button === 2 || (event.button === 0 && event.shiftKey)) mousePan = { x: event.clientX, y: event.clientY }
      return
    }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    pinch = pointers.size === 2 ? pinchOf() : null
  }
  const onPointerMove = (event: PointerEvent) => {
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
      controls.dispose()
      if (figure) disposeGroup(figure)
      floor.geometry.dispose()
      ;(floor.material as THREE.Material).dispose()
      renderer.dispose()
    },
  }
}
