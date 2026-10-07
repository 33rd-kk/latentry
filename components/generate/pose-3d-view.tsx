"use client"

import { useEffect, useRef } from "react"
import {
  createPoseViewer,
  type PosePerson3d,
  type PoseViewer,
  type ViewerCamera,
  type ViewerFrame,
} from "@/components/pose3d/viewer"

interface Pose3dViewProps {
  people: PosePerson3d[]
  /** Which person is shown, or -1 for everyone. */
  person: number
  limits: { yaw: number; pitch: number; zoom: readonly [number, number] }
  frame: ViewerFrame
  /** Where the camera stands and what it frames; changing it moves the view. */
  camera: ViewerCamera
  onCameraChange: (camera: ViewerCamera) => void
}

const sameCamera = (a: ViewerCamera, b: ViewerCamera) =>
  a.yaw === b.yaw &&
  a.pitch === b.pitch &&
  a.framing.zoom === b.framing.zoom &&
  a.framing.x === b.framing.x &&
  a.framing.y === b.framing.y

/**
 * The 3D pose viewer (components/pose3d, three.js only) as a React component,
 * shaped like the output so it shows exactly the area the skeleton covers.
 * Loaded with next/dynamic and ssr: false, since WebGL exists only in the browser.
 */
export default function Pose3dView({ people, person, limits, frame, camera, onCameraChange }: Pose3dViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewerRef = useRef<PoseViewer | null>(null)
  // The viewer is made once; later props reach it through these.
  const onChangeRef = useRef(onCameraChange)
  const initial = useRef({ people, person, limits, frame, camera })

  useEffect(() => {
    onChangeRef.current = onCameraChange
  }, [onCameraChange])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const viewer = createPoseViewer(canvas, {
      ...initial.current,
      onChange: (moved) => onChangeRef.current(moved),
    })
    viewerRef.current = viewer
    return () => {
      viewer.dispose()
      viewerRef.current = null
    }
  }, [])

  useEffect(() => {
    viewerRef.current?.setPeople(people, person)
  }, [people, person])

  useEffect(() => {
    viewerRef.current?.setFrame(frame)
  }, [frame])

  useEffect(() => {
    const viewer = viewerRef.current
    if (viewer && !sameCamera(viewer.getCamera(), camera)) viewer.setCamera(camera)
  }, [camera])

  // The output's shape, at most 18rem wide and 24rem tall: sized by width
  // alone, so the aspect is never squeezed (the projection assumes it).
  return (
    <canvas
      ref={canvasRef}
      style={{
        aspectRatio: `${frame.output.width} / ${frame.output.height}`,
        width: `min(100%, 18rem, calc(24rem * ${frame.output.width} / ${frame.output.height}))`,
      }}
      className="block cursor-grab touch-none rounded-md border border-border/50 bg-black active:cursor-grabbing dark:border-white/20"
    />
  )
}
