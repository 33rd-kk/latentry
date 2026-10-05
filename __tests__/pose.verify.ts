/**
 * The pose request Latentry passes on to a backend (lib/pose.ts): what is
 * kept, what is refused, and the camera held to the limits a single
 * picture's depth supports. And the 3D view's projection
 * (components/pose3d/projection.ts) against poseorbit's own drawing: the
 * fixture holds canvas positions computed by poseorbit's geometry.py for
 * turned and framed cameras, which the view must reproduce to the pixel.
 *
 * Run with: npm test -- pose
 */
import * as THREE from 'three'
import { check, done, eq } from './assert'
import { POSE_LIMITS, toPoseRequest } from '../lib/pose'
import { aimCamera, frustumFor, toThree } from '../components/pose3d/projection'
import fixtures from './fixtures/pose-view.json'

eq(toPoseRequest(null), 'image_base64 is required', 'no body')
eq(toPoseRequest({ image_base64: '' }), 'image_base64 is required', 'empty picture')
eq(toPoseRequest({ image_base64: 'x' }), { image_base64: 'x' }, 'a picture alone')
eq(
  toPoseRequest({ image_base64: 'x', width: 832, height: 1216, person: -1, want_3d: true }),
  { image_base64: 'x', width: 832, height: 1216, person: -1, want_3d: true },
  'size, everyone, 3D points'
)
eq(toPoseRequest({ image_base64: 'x', person: -2, want_3d: 'yes' }), { image_base64: 'x' }, 'a bad person and a non-boolean want_3d are dropped')
eq(
  toPoseRequest({ image_base64: 'x', camera: { yaw: 30, pitch: -10 } }),
  { image_base64: 'x', camera: { yaw: 30, pitch: -10 } },
  'a camera within the limits'
)
eq(
  toPoseRequest({ image_base64: 'x', camera: { yaw: 400, pitch: -90 } }),
  { image_base64: 'x', camera: { yaw: POSE_LIMITS.yaw, pitch: -POSE_LIMITS.pitch } },
  'a camera past the limits is clamped'
)
eq(toPoseRequest({ image_base64: 'x', camera: { yaw: 10 } }), { image_base64: 'x', camera: { yaw: 10, pitch: 0 } }, 'a missing angle is 0')
eq(toPoseRequest({ image_base64: 'x', camera: { yaw: 'left' } }), 'camera must be { yaw, pitch } in degrees', 'a camera that is not numbers')
eq(toPoseRequest({ image_base64: 'x', camera: 5 }), 'camera must be { yaw, pitch } in degrees', 'a camera that is not an object')
eq(
  toPoseRequest({ image_base64: 'x', camera: { yaw: 0, framing: { zoom: 3, x: 0.4, y: 0.2 } } }),
  { image_base64: 'x', camera: { yaw: 0, pitch: 0, framing: { zoom: 3, x: 0.4, y: 0.2 } } },
  'a framing within the limits'
)
eq(
  toPoseRequest({ image_base64: 'x', camera: { framing: { zoom: 50, x: -1 } } }),
  { image_base64: 'x', camera: { yaw: 0, pitch: 0, framing: { zoom: POSE_LIMITS.zoom[1], x: 0, y: 0.5 } } },
  'a framing past the limits is clamped, a missing centre is the middle'
)
eq(
  toPoseRequest({ image_base64: 'x', camera: { framing: { zoom: 'big' } } }),
  'camera.framing must be { zoom, x, y }',
  'a framing that is not numbers'
)

for (const [index, fixture] of fixtures.entries()) {
  const centre = { x: fixture.centre[0], y: fixture.centre[1] }
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100)
  Object.assign(camera, frustumFor({ aspect: fixture.aspect, output: fixture.output }, fixture.framing, centre))
  camera.updateProjectionMatrix()
  aimCamera(camera, toThree([centre.x, centre.y, 0]), fixture.yaw, fixture.pitch)
  camera.updateMatrixWorld()
  let worst = 0
  fixture.points.forEach((point, at) => {
    const ndc = toThree(point).project(camera)
    const x = ((ndc.x + 1) / 2) * fixture.output.width
    const y = ((1 - ndc.y) / 2) * fixture.output.height
    worst = Math.max(worst, Math.hypot(x - fixture.expected[at][0], y - fixture.expected[at][1]))
  })
  check(worst < 0.05, `view ${index} (yaw ${fixture.yaw}, pitch ${fixture.pitch}, zoom ${fixture.framing.zoom}) matches poseorbit: off by ${worst.toFixed(4)} px`)
}

done('pose')
