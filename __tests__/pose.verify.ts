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
import {
  ALL_PEOPLE,
  FRONT,
  MAX_CHOSEN,
  POSE_LIMITS,
  WHOLE_FRAME,
  chosenIndices,
  readPoseAnswer,
  sameView,
  toggledChoice,
  toPoseRequest,
} from '../lib/pose'
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
eq(toPoseRequest({ image_base64: 'x', person: [2, 0, 2] }), { image_base64: 'x', person: [0, 2] }, 'some people: sorted, without repeats')
for (const person of [[], [0, -1], [0, 1.5], ['0'], [true], Array.from({ length: MAX_CHOSEN + 1 }, (_, index) => index)]) {
  eq(toPoseRequest({ image_base64: 'x', person }), `person as a list must hold 1-${MAX_CHOSEN} indices`, `a bad list is refused: ${JSON.stringify(person).slice(0, 20)}`)
}
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

// The pose slot's reading of /api/pose answers (lib/pose.ts readPoseAnswer).
eq(readPoseAnswer(null), null, 'answer: none')
eq(readPoseAnswer({ error: 'No person found' }), null, 'answer: an error has no skeleton')
eq(
  readPoseAnswer({ skeleton_base64: 'AAA', width: 832, height: 1216 }),
  {
    skeleton: { dataUrl: 'data:image/png;base64,AAA', width: 832, height: 1216 },
    people: [],
    person: null,
    subsets: false,
    limits: null,
    style: null,
    jointsInFrame: null,
    camera: FRONT,
  },
  'answer: a backend that sends only the skeleton cannot turn it, picks one or everyone, and drew it from the front'
)
const full = readPoseAnswer({
  skeleton_base64: 'AAA',
  width: 832,
  height: 1216,
  person: -1,
  people: [{ bbox: [0, 0, 0.5, 1] }, { bbox: [0.5, 0, 1, 1] }],
  limits: { yaw: 90, pitch: 45, zoom: [0.5, 6] },
  style: 'openpose',
  joints_in_frame: 9,
  camera: { yaw: 40, pitch: 10 },
})
eq(full?.person, ALL_PEOPLE, 'answer: everyone')
eq(full?.people.length, 2, 'answer: the people found')
eq(full?.limits, { yaw: 90, pitch: 45, zoom: [0.5, 6] }, 'answer: turning limits')
eq(full?.style, 'openpose', 'answer: drawing style')
eq(full?.jointsInFrame, 9, 'answer: joints in frame')
eq(full?.camera, { yaw: 40, pitch: 10, framing: WHOLE_FRAME }, 'answer: a camera without framing frames the whole picture')
eq(
  readPoseAnswer({ skeleton_base64: 'AAA', limits: { yaw: 90, pitch: 45 } })?.limits,
  { yaw: 90, pitch: 45, zoom: [1, 1] },
  'answer: a backend without zoom limits cannot zoom'
)
check(sameView(FRONT, { yaw: 0, pitch: 0, framing: { zoom: 1, x: 0.5, y: 0.5 } }), 'sameView: the front equals itself')
check(!sameView(FRONT, { yaw: 0, pitch: 0, framing: { zoom: 2, x: 0.5, y: 0.5 } }), 'sameView: a zoom is another view')

// Some of the people (person_subsets).
const some = readPoseAnswer({ skeleton_base64: 'AAA', person: [0, 2], person_subsets: true })
eq(some?.person, [0, 2], 'answer: some people')
eq(some?.subsets, true, 'answer: the backend takes a list')
eq(readPoseAnswer({ skeleton_base64: 'AAA', person: ['a'] })?.person, null, 'answer: a list that is not indices is nobody said')
eq([...chosenIndices(null, 3)], [], 'chosen: nobody')
eq([...chosenIndices(ALL_PEOPLE, 3)], [0, 1, 2], 'chosen: everyone')
eq([...chosenIndices(1, 3)], [1], 'chosen: one')
eq([...chosenIndices([0, 2], 3)], [0, 2], 'chosen: some')
eq(toggledChoice(1, 0, 3), [0, 1], 'toggle: adding a second person makes a list')
eq(toggledChoice([0, 1], 1, 3), 0, 'toggle: back to one person is a plain index')
eq(toggledChoice([0, 1], 2, 3), ALL_PEOPLE, 'toggle: all of them is everyone')
eq(toggledChoice(ALL_PEOPLE, 1, 3), [0, 2], 'toggle: leaving one out of everyone')
eq(toggledChoice(1, 1, 3), null, 'toggle: the last one cannot be left out')
eq(toggledChoice(null, 2, 3), 2, 'toggle: from nobody said, one person')

done('pose')
