// How the 3D pose view maps the picture to the screen, matching poseorbit's
// drawing (geometry.py): an orthographic camera orbiting the hips, the
// picture letterboxed onto the output canvas, then the framing's crop.
// Kept apart from the viewer so it can be checked without a browser.

import * as THREE from "three"

export const DEG = Math.PI / 180
export const DISTANCE = 4

/** The canvas point (x, y), as fractions, that goes to the middle, scaled by zoom. */
export interface ViewerFraming {
  zoom: number
  x: number
  y: number
}

export interface ViewerFrame {
  /** The reference picture's height / width. */
  aspect: number
  /** The output canvas the skeleton is drawn on. */
  output: { width: number; height: number }
}

/** The picture's (x, y down, z away) as three.js's (x, y up, z toward the viewer). */
export const toThree = (point: number[]) => new THREE.Vector3(point[0], -point[1], -point[2])

/**
 * The orthographic bounds, around the orbit centre (picture units, y down),
 * that show exactly the framed part of the output canvas: the picture
 * (1 wide, `aspect` tall) is letterboxed onto the canvas, then the framing
 * crops it, as poseorbit draws it.
 */
export function frustumFor(frame: ViewerFrame, framing: ViewerFraming, centre: { x: number; y: number }) {
  const { width, height } = frame.output
  const scale = Math.min(width, height / frame.aspect)
  const offsetX = (width - scale) / 2
  const offsetY = (height - scale * frame.aspect) / 2
  const halfW = width / 2 / framing.zoom
  const halfH = height / 2 / framing.zoom
  const toPictureX = (px: number) => (px - offsetX) / scale - centre.x
  const toPictureY = (py: number) => (py - offsetY) / scale - centre.y
  return {
    left: toPictureX(framing.x * width - halfW),
    right: toPictureX(framing.x * width + halfW),
    top: -toPictureY(framing.y * height - halfH),
    bottom: -toPictureY(framing.y * height + halfH),
  }
}

/** Puts `camera` at (yaw, pitch) degrees around `target`, looking at it. */
export function aimCamera(camera: THREE.Camera, target: THREE.Vector3, yaw: number, pitch: number) {
  const y = yaw * DEG
  const p = pitch * DEG
  camera.position
    .set(Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p))
    .multiplyScalar(DISTANCE)
    .add(target)
  camera.lookAt(target)
}

