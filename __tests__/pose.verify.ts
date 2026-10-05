/**
 * The pose request Latentry passes on to a backend (lib/pose.ts): what is
 * kept, what is refused, and the camera held to the limits a single
 * picture's depth supports.
 *
 * Run with: npm test -- pose
 */
import { done, eq } from './assert'
import { POSE_LIMITS, toPoseRequest } from '../lib/pose'

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

done('pose')
