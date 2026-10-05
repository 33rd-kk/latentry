// A 3D view of detected poses whose camera can be dragged around the figure,
// within limits. Plain three.js on a canvas: no React, no app code, so it can
// be lifted out with poseorbit.
//
// Points come from poseorbit's /api/pose `want_3d`: x right, y down, z away
// from the viewer, all in units of the picture's width. The camera here is
// orthographic and orbits the same centre poseorbit turns around (the middle
// of the shown people's hips), so what is seen is what the server will draw
// for the same yaw and pitch.

import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { COCO133_LINKS, FACE_POINTS, KEYPOINT_THRESHOLD } from "./skeleton"

export interface PosePerson3d {
  points_3d: number[][]
  scores: number[]
}

export interface ViewerCamera {
  /** Degrees; + swings the camera to the viewer's right. */
  yaw: number
  /** Degrees; + raises the camera. */
  pitch: number
}

export interface PoseViewerOptions {
  people: PosePerson3d[]
  /** Which person is shown, or -1 for everyone. */
  person: number
  /** How far the camera may swing, in degrees. */
  limits: { yaw: number; pitch: number }
  camera?: ViewerCamera
  /** Called while the camera moves. */
  onChange?: (camera: ViewerCamera) => void
}

export interface PoseViewer {
  setPeople(people: PosePerson3d[], person: number): void
  getCamera(): ViewerCamera
  setCamera(camera: ViewerCamera): void
  dispose(): void
}

const DEG = Math.PI / 180
const DISTANCE = 4

/** The picture's (x, y down, z away) as three.js's (x, y up, z toward the viewer). */
const toThree = (point: number[]) => new THREE.Vector3(point[0], -point[1], -point[2])

function centreOf(people: PosePerson3d[]): THREE.Vector3 {
  const hips = people.flatMap((person) => [person.points_3d[11], person.points_3d[12]])
  const x = hips.reduce((sum, point) => sum + point[0], 0) / hips.length
  const y = hips.reduce((sum, point) => sum + point[1], 0) / hips.length
  return toThree([x, y, 0])
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
  controls.enablePan = false
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
  let extent = 0.5

  const render = () => renderer.render(scene, camera)

  const fitView = () => {
    const { clientWidth: width, clientHeight: height } = canvas
    if (!width || !height) return
    renderer.setSize(width, height, false)
    const aspect = width / height
    // Big enough for the figure seen from any allowed angle.
    const half = extent * 0.6
    camera.left = -half * Math.max(aspect, 1)
    camera.right = half * Math.max(aspect, 1)
    camera.top = half / Math.min(aspect, 1)
    camera.bottom = -half / Math.min(aspect, 1)
    camera.updateProjectionMatrix()
    render()
  }

  const read = (): ViewerCamera => {
    const offset = camera.position.clone().sub(controls.target)
    return {
      yaw: Math.round(Math.atan2(offset.x, offset.z) / DEG),
      pitch: Math.round(Math.atan2(offset.y, Math.hypot(offset.x, offset.z)) / DEG),
    }
  }

  const place = ({ yaw, pitch }: ViewerCamera) => {
    const y = Math.max(-options.limits.yaw, Math.min(options.limits.yaw, yaw)) * DEG
    const p = Math.max(-options.limits.pitch, Math.min(options.limits.pitch, pitch)) * DEG
    camera.position
      .set(Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p))
      .multiplyScalar(DISTANCE)
      .add(controls.target)
    camera.lookAt(controls.target)
    controls.update()
    render()
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
    controls.target.copy(shown.length ? centreOf(shown) : new THREE.Vector3())
    const box = new THREE.Box3().setFromObject(figure)
    extent = Math.max(0.2, box.getSize(new THREE.Vector3()).length())
    floor.position.set(controls.target.x, box.min.y, controls.target.z)
    fitView()
    place(keep)
  }

  controls.addEventListener("change", () => {
    render()
    options.onChange?.(read())
  })
  const observer = new ResizeObserver(fitView)
  observer.observe(canvas)

  camera.position.set(0, 0, DISTANCE)
  setPeople(options.people, options.person)
  place(options.camera ?? { yaw: 0, pitch: 0 })

  return {
    setPeople,
    getCamera: read,
    setCamera: place,
    dispose() {
      observer.disconnect()
      controls.dispose()
      if (figure) disposeGroup(figure)
      floor.geometry.dispose()
      ;(floor.material as THREE.Material).dispose()
      renderer.dispose()
    },
  }
}
